import {getTasksStorageInstance} from "../storages/factory";

const Promise = require('bluebird');

import {KueQueue} from '../utils/kueQueue';
import {
    Workflow, WorkflowHash,
    Statuses, TaskHash, TaskStatus, WorkflowStatus,
    BackendInterface, KueBackendConfiguration,
} from '../index.d';
import {ExecutionErrorType} from '../common';
import {update} from '../immutability';
import {Backend} from './Backend';
import {Storage} from '../storages/Storage';

/**
 * Use a redis backend and queue tasks with kue.
 *
 * To each task of a workflow instance corresponds a redis hash : "workflowTask_<workflowId>_<taskPath>",
 * with the following  keys :
 *    - status : Status
 *    - body : JSON string (either a result or an error)
 *    - executionTime : number (last execution)
 */
export class KueBackend extends Backend implements BackendInterface {
    private storage: Storage;
    private queue: KueQueue;

    private deleteHandler;

    public constructor(config: KueBackendConfiguration) {
        super();

        this.storage = getTasksStorageInstance(config.tasksStorage);
        this.queue = new KueQueue(config.redis, this.storage, this);

        this.deleteHandler = config.onDeleteWorkflow;
    }

    public initializeWorkflow(realm: string, workflowGenerator: string, workflowData: any, workflowId: string, options) {
        return this.generateWorkflow(workflowGenerator, workflowData, workflowId)
            .then(workflow => {
                let paths = workflow.getAllPaths();
                return this.storage.initWorkflow(realm, workflowGenerator, workflowData, paths, workflowId,
                    options.baseContext, options.ephemeral);
            });
    }

    /**
     * Get results of a task for a given workflow.
     *
     * @param {string} workflowId
     * @param {string} taskPath
     */
    private getTaskHash(workflowId: string, taskPath: string): Promise<TaskHash> {
        return this.storage.getTask(workflowId, taskPath);
    }

    /**
     * Queue the task.
     * Register listeners to broadcast results through the websockets.
     *
     * @param workflowId
     * @param taskPath
     * @param argument
     */
    public executeOneTask(workflowId: string, taskPath: string, argument = null) {
        // First, get the workflow to make sure it still exists
        return this.storage.getWorkflow(workflowId).then((workflow) => {
            if (workflow == null || workflow.generator == null) {
                console.warn("[JOBS] Workflow does not exist : " + workflowId);
            } else {
                return this.storage.setTaskStatus(workflowId, taskPath, 'queued')
                    .then(() => {
                        return this.storage.getTask(workflowId, taskPath).then(taskHash => {
                            let watcher = this.queue.scheduleTask(workflowId, taskPath, argument);
                            return {taskHash, watcher};
                        })
                    });
            }
        })
    }

    /**
     * Actual execution of a SINGLE task of a workflow instance.
     * This function should be called by the handler register in executeOneTask();
     *
     * Return a promise resolving to the result of this task.
     *
     * @param workflowId
     * @param path
     * @param baseContext
     * @param argument If null, the previous result (ie of the previous task) is used.
     */
    public run(workflowId: string, path = '#', baseContext = {}, argument = null): Promise<any> {
        let self = this;

        /**
         * Traverse the workflow and fill the context with previous result.
         * If a result is missing, throw an error.
         *
         * Return the task whith the given @param path.
         *
         * @param currentContext The future task context, build recursively
         */

        let currentDate = new Date();
        let contextUpdaters = [];
        let factory = {
            context: null,
            previousContext: null,

            // Pure functional : no side effects. The updater is also serialized in the redis database.
            updateContext(updater) {
                contextUpdaters.push(updater);
                try {
                    this.context = update(this.context, updater);
                }
                catch (e) {
                    // TODO return  ExecutionErrorType.CONTEXT_UPDATE
                    console.warn('Fail to update context', e);
                }
            },

            ... self.baseFactory()
        };

        return this.storage.getWorkflow(workflowId)
            .then((workflowHash: WorkflowHash) => {
                return this.generateWorkflow(workflowHash.generator, workflowHash.generatorData, workflowId)
                    .then(workflow => {
                        return workflow
                            .getTask(path, baseContext, self.getTaskHash.bind(self))
                            .then(res => {
                                let {task, context, prevResult, resultContext} = res;
                                if (argument == null) {
                                    argument = prevResult;
                                }

                                if (task.condition != null) {
                                    if (!task.condition(context)) {
                                        // Bypass this task, and mark it as executed
                                        let taskHash = {
                                            realm: workflowHash.realm,
                                            status: 'ok' as TaskStatus,
                                            argument: null,
                                            body: 'Task skipped',
                                            contextUpdaters,
                                            context,
                                            executionTime: currentDate.getTime(),
                                        };
                                        return self.storage.setTask(workflowId, path, taskHash);
                                    }
                                }

                                let callingContext = context; // The "received" context before executing the task callback
                                factory.context = context;
                                factory.previousContext = resultContext;
                                try {
                                    // Actual execution of the task
                                    return task.execute(argument, factory)
                                        .catch(err => {
                                            if (err instanceof Error) {
                                                err = err.message;
                                            }
                                            return Promise.reject({
                                                type: ExecutionErrorType.EXECUTION_FAILED,
                                                payload: {
                                                    body: err,
                                                    argument,
                                                    context: callingContext,
                                                    contextUpdaters,
                                                },
                                            });
                                        })
                                        .then((taskResult) => {
                                            // Middleware to perform operations with the task result
                                            if (task.onComplete != null) {
                                                console.log("[TASK COMPLETE] " + task.onComplete);
                                            }

                                            if (task.debug != null) {
                                                task.debug(taskResult, factory.context);
                                            }

                                            // Update the task hash
                                            let taskHash = {
                                                realm: workflowHash.realm,
                                                status: 'ok' as TaskStatus,
                                                argument,
                                                context: callingContext,
                                                body: taskResult || null,
                                                contextUpdaters,
                                                executionTime: currentDate.getTime(),
                                            };
                                            return self.storage.setTask(workflowId, path, taskHash);
                                        });
                                }
                                catch (err) {
                                    // Direct exception in the task callback
                                    return Promise.reject({
                                        type: ExecutionErrorType.EXECUTION_FAILED,
                                        payload: {
                                            body: typeof err == 'string' ? err : err.toString(),
                                            argument,
                                            context: callingContext,
                                        },
                                    });
                                }
                            });
                    });
            });
    }

    public getWorkflowBaseContext(workflowId: string): Promise<any> {
        return this.storage.getWorkflowField(workflowId, 'baseContext');
    }

    /**
     * @inheritDoc
     */
    public getWorkflow(workflowId, interCallback = () => null): Promise<{
        workflow: Workflow,
        workflowHash: WorkflowHash
    }> {
        let self = this;
        return this.storage.getWorkflow(workflowId)
            .then((workflowHash: WorkflowHash) => {
                interCallback();
                return self.generateWorkflow(workflowHash.generator,
                    workflowHash.generatorData, workflowId)
                    .then(workflow => {
                        return {workflow, workflowHash};
                    });
            });
    }

    /**
     * @inheritDoc
     */
    public updateWorkflow(workflowId: string, workflowUpdater) {
        return this.storage.getWorkflow(workflowId)
            .then((workflow: WorkflowHash) => {
                let newWorkflow = update(workflow, workflowUpdater);

                return this.storage.saveWorkflow(workflowId, newWorkflow);
            });
    }

    public setWorkflowStatus(workflowId: string, status: WorkflowStatus): Promise<{}> {
        return this.storage.setWorkflowStatus(workflowId, status);
    }

    /**
     * @inheritDoc
     */
    public getTasksStatuses(paths: string[], workflowId: string): Promise<Statuses> {
        return this.storage.getTasksStatuses(paths, workflowId);
    }

    public getAllWorkflowsUids() {
        return this.storage.getAllWorkflowsUids();
    }

    /**
     * Delete tasks hashs and workflow hash in redis.
     *
     * @inheritDoc
     */
    public deleteWorkflow(workflowId: string): Promise<{}> {
        let self = this;
        return this.getWorkflow(workflowId)
            .then(({workflow, workflowHash}) => {
                let paths = workflow.getAllPaths();
                return Promise.all([
                    this.storage.deleteWorkflow(workflowId),
                    this.storage.deleteTasks(workflowId, paths),
                ]).then(() => {
                    if (self.deleteHandler != null) {
                        self.deleteHandler(workflowId);
                    }
                })
            });
    }

    public deleteWorkflowsByRealm(realm: string): Promise<any> {
        let self = this;
        return this.storage.deleteByField('realm', realm).then(workflowIds => {
            if (self.deleteHandler) {
                workflowIds.map(self.deleteHandler);
            }
        });
    }
}

