import { Queue } from '../queue';
import {
    Workflow, WorkflowHash,
    Statuses, TaskHash, TaskStatus, WorkflowStatus,
    BackendInterface, AsyncBackendConfiguration,
} from '../index.d';
import { Redis } from '../storages/Redis';
import { ExecutionErrorType } from '../common';

const Promise = require('bluebird');

import { update } from '../immutability';
import { getResultContext } from '../workflows/context';
import { Backend } from './Backend';
import { TaskWatcher } from './watcher';

/**
 * Use a redis backend and queue tasks with kue.
 *
 * To each task of a workflow instance corresponds a redis hash : "workflowTask_<workflowId>_<taskPath>",
 * with the following  keys :
 *    - status : Status
 *    - body : JSON string (either a result or an error)
 *    - executionTime : number (last execution)
 */
export class AsyncBackend extends Backend implements BackendInterface
{
    private redis : Redis;
    private queue : Queue;

    public constructor(config : AsyncBackendConfiguration)
    {
        super();

        this.redis = new Redis(config.redis);
        this.queue = new Queue(config.redis, this.redis, this);
    }

    public initializeWorkflow(workflowGenerator : string, workflowData : any, workflowId : string, options)
    {
        return this.generateWorkflow(workflowGenerator, workflowData, workflowId)
                   .then(workflow => {
                       let paths = workflow.getAllPaths();
                       return this.redis.initWorkflow(workflowGenerator, workflowData, paths, workflowId,
                           options.baseContext, options.ephemeral);
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
        return this.redis.getTask(workflowId, taskPath);
    }

    /**
     * Queue the task.
     * Register listeners to broadcast results through the websockets.
     *
     * @param workflowId
     * @param taskPath
     * @param argument
     */
    public executeOneTask(workflowId : string, taskPath : string, argument = null) : Promise<TaskWatcher>
    {
        return this.redis.setTaskStatus(workflowId, taskPath, 'queued')
                   .then(() => {
                       let watcher = this.queue.scheduleTask(workflowId, taskPath, argument);
                       return watcher;
                   });
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
    public run(workflowId : string, path = '#', baseContext = {}, argument = null) : Promise<any>
    {
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
            updateContext(updater)
            {
                contextUpdaters.push(updater);
                try {
                    this.context = update(this.context, updater);
                }
                catch (e) {
                    // TODO return  ExecutionErrorType.CONTEXT_UPDATE
                    console.log('Fail to update context', e);
                }
            },

            ... self.baseFactory()
        };

        return this.redis.getWorkflow(workflowId)
                   .then((workflowHash : WorkflowHash) => {
                       return this.generateWorkflow(workflowHash.generator, workflowHash.generatorData, workflowId);
                   })
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
                                           status: 'ok' as TaskStatus,
                                           argument: null,
                                           body: 'Task skipped',
                                           contextUpdaters,
                                           context,
                                           executionTime: currentDate.getTime(),
                                       };
                                       return self.redis.setTask(workflowId, path, taskHash);
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
                                                      console.log(task.onComplete);
                                                  }

                                                  if (task.debug != null) {
                                                      task.debug(taskResult, factory.context);
                                                  }

                                                  // Update the task hash
                                                  let taskHash = {
                                                      status: 'ok' as TaskStatus,
                                                      argument,
                                                      context: callingContext,
                                                      body: taskResult || null,
                                                      contextUpdaters,
                                                      executionTime: currentDate.getTime(),
                                                  };
                                                  return self.redis.setTask(workflowId, path, taskHash);
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
    }

    public getWorkflowBaseContext(workflowId : string) : Promise<any>
    {
        return this.redis.getWorkflowField(workflowId, 'baseContext');
    }

    /**
     * @inheritDoc
     */
    public getWorkflow(workflowId, interCallback = () => null) : Promise<{
        workflow : Workflow,
        workflowHash : WorkflowHash
    }>
    {
        let self = this;
        return this.redis.getWorkflow(workflowId)
                   .then((workflowHash : WorkflowHash) => {
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
    public updateWorkflow(workflowId : string, workflowUpdater)
    {
        return this.redis.getWorkflow(workflowId)
                   .then((workflow : WorkflowHash) => {
                       let newWorkflow = update(workflow, workflowUpdater);

                       return this.redis.saveWorkflow(workflowId, newWorkflow);
                   });
    }

    public setWorkflowStatus(workflowId : string, status : WorkflowStatus) : Promise<{}>
    {
        return this.redis.setWorkflowStatus(workflowId, status);
    }

    /**
     * @inheritDoc
     */
    public getTasksStatuses(paths : string[], workflowId : string) : Promise<Statuses>
    {
        return this.redis.getTasksStatuses(paths, workflowId);
    }

    /**
     * Delete tasks hashs and workflow hash in redis.
     *
     * @inheritDoc
     */
    public deleteWorkflow(workflowId : string) : Promise<{}>
    {
        return this.getWorkflow(workflowId)
                   .then(({workflow, workflowHash}) => {
                       let paths = workflow.getAllPaths();
                       return Promise.all([
                           this.redis.deleteWorkflow(workflowId),
                           this.redis.deleteTasks(workflowId, paths),
                       ]);
                   });
    }
}

