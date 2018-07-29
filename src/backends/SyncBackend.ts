import { TaskWatcher } from './watcher';

const Promise = require('bluebird');

import { ExecutionErrorType } from '../common';
import {
    Workflow, WorkflowGenerator, WorkflowHash,
    TaskHash, TaskError,
    Statuses, TaskStatus, WorkflowStatus,
    ControllerInterface, SyncBackendConfiguration, BackendInterface,
} from '../index.d';
import { update } from '../immutability';
import { Backend } from './Backend';

/**
 * This backend store all workflow/tasks hashes in its attributes (ie in-memory, don't use tasks backend).
 */
export class SyncBackend extends Backend implements BackendInterface
{
    private contexts : {
        [workflowId : string] : any
    } = {};
    private workflows : {
        [workflowId : string] : {
            hash : WorkflowHash;
            tasks : {
                [taskPath : string] : TaskHash;
            }
        }
    };

    public constructor(config : SyncBackendConfiguration)
    {
        super();

        this.workflows = {};
        this.contexts = {};
    }

    public initializeWorkflow(realm : string, workflowGenerator : string, workflowData : any, workflowId : string, options)
    {
        let self = this;
        return this.generateWorkflow(workflowGenerator, workflowData, workflowId)
                   .then(workflow => {
                       let paths = workflow.getAllPaths();
                       let tasks = {};
                       for (let path of paths) {
                           tasks[path] = {
                               realm,
                               status: 'inactive',
                               body: null,
                               argument: null,
                               context: {},
                               contextUpdaters: [],
                               executionTime: null,
                           };
                       }
                       self.workflows[workflowId] = {
                           hash: {
                               realm,
                               generator: workflowGenerator,
                               generatorData: workflowData,
                               baseContext: options.baseContext,
                               ephemeral: options.ephemeral,
                               status: 'working' as WorkflowStatus,
                           } as WorkflowHash,
                           tasks,
                       };
                   });
    }

    /**
     * Get results of a task for a given workflow.
     *
     * @param {string} workflowId
     * @param {string} taskPath
     */
    private getTaskHash(workflowId : string, taskPath : string) : Promise<TaskHash>
    {
        return Promise.resolve(this.workflows[workflowId].tasks[taskPath]);
    }

    /**
     * Execute a single task of the workflow.
     *
     * Return a promise resolving to the result of this task.
     *
     * @param workflowId
     * @param path
     * @param baseContext
     * @param argument If null, the previous result (ie of the previous task) is used.
     */
    public executeOneTask(workflowId : string, path = '#', argument = null) : Promise<TaskWatcher>
    {
        let self = this;
        let workflowDetails = this.workflows[workflowId];
        let currentDate = new Date();

        let contextUpdaters = [];
        let factory = {
            context: null,
            previousContext: null,

            // Pure functional : no side effects. The updater is also serialized in the redis database.
            updateContext(updater)
            {
                contextUpdaters.push(updater);
                try {
                    this.context = update(this.context, updater);
                }
                catch (e) {
                    // TODO return  ExecutionErrorType.CONTEXT_UPDATE
                    console.log(e);
                }
            },

            ... this.baseFactory()
        };

        let watcher = new TaskWatcher();

        this.generateWorkflow(workflowDetails.hash.generator, workflowDetails.hash.generatorData, workflowId)
            .then(workflow => {
                return workflow.getTask(path, workflowDetails.hash.baseContext, this.getTaskHash.bind(this));
            })
            .then(res => {
                let {task, context, prevResult, resultContext} = res;
                if (argument == null) {
                    argument = prevResult;
                }

                if (task.condition != null) {
                    if (!task.condition(context)) {
                        // Bypass this task, and mark it as executed
                        let taskHash = {
                            realm: workflowDetails.hash.realm,
                            status: 'ok' as TaskStatus,
                            argument,
                            context,
                            body: {message: 'Task skipped'},
                            contextUpdaters: [],
                            executionTime: currentDate.getTime(),
                        };
                        self.workflows[workflowId].tasks[path] = taskHash;
                        watcher.complete(taskHash);
                        return;
                    }
                }

                let callingContext = context; // The "received" context before executing the task callback
                factory.context = context;
                factory.previousContext = resultContext;
                try {
                    task.execute(argument, factory)
                        .then((taskResult) => {
                            // Middleware (only onComplete, no debug).
                            if (task.onComplete != null) {
                                // TODO logging
                                console.log(task.onComplete);
                            }

                            // Update the task hash
                            let taskHash = {
                                realm: workflowDetails.hash.realm,
                                status: 'ok' as TaskStatus,
                                argument,
                                context: callingContext,
                                body: taskResult || null,
                                contextUpdaters,
                                executionTime: currentDate.getTime(),
                            };
                            self.workflows[workflowId].tasks[path] = taskHash;
                            watcher.complete(taskHash);
                        })
                        .catch(err => {
                            if (err instanceof Error) {
                                err = err.message;
                            }
                            let taskError = {
                                type: ExecutionErrorType.EXECUTION_FAILED,
                                payload: {
                                    body: err,
                                    argument,
                                    context: callingContext,
                                    contextUpdaters,
                                },
                            };
                            watcher.failed(taskError);
                        });
                }
                catch (err) {
                    // Direct exception in the task callback
                    let taskError = {
                        type: ExecutionErrorType.EXECUTION_FAILED,
                        payload: {
                            body: typeof err == 'string' ? err : err.toString(),
                            argument,
                            context: callingContext,
                        },
                    };
                    watcher.failed(taskError);
                }
            });

        return Promise.resolve(watcher);
    }

    public updateWorkflow(workflowId : string)
    {
        return new Promise.reject('Cannot update a workflow with the Sync backend');
    }

    /**
     * @inheritDoc
     */
    public getTasksStatuses(paths : string[], workflowId : string) : Promise<Statuses>
    {
        let statuses = {};
        for (let path of paths) {
            statuses[path] = this.workflows[workflowId].tasks[path];
        }
        return Promise.resolve(statuses);
    }

    public setWorkflowStatus(workflowId : string, status : WorkflowStatus)
    {
        this.workflows[workflowId].hash.status = status;
        return Promise.resolve();
    }

    /**
     * @inheritDoc
     */
    public getWorkflow(workflowId, interCallback = () => null) : Promise<{
        workflow : Workflow,
        workflowHash : WorkflowHash
    }>
    {
        let workflowHash = this.workflows[workflowId].hash;
        return this.generateWorkflow(workflowHash.generator, workflowHash.generatorData, workflowId)
                   .then(workflow => {
                       return {workflow, workflowHash};
                   });
    }

    public getWorkflowBaseContext(workflowId : string) : Promise<any>
    {
        return this.workflows[workflowId].hash.baseContext;
    }

    public getAllWorkflowsUids() {
        return Promise.resolve(Object.keys(this.workflows));
    }

    /**
     * @inheritDoc
     */
    public deleteWorkflow(workflowId : string) : Promise<{}>
    {
        delete this.workflows[workflowId];
        delete this.contexts[workflowId];
        return Promise.resolve();
    }

    public deleteWorkflowsByRealm(realm : string) : Promise<{}>
    {
        let newWorkflows = {};
        for (let workflowUid in this.workflows) {
            let workflow = this.workflows[workflowUid];
            if (workflow.hash.realm != realm) {
                newWorkflows[workflowUid] = workflow;
            }
        }
        this.workflows = newWorkflows;
        return new Promise();
    }
}

