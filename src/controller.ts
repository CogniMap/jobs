import { Jobs } from './jobs';
import {
    Workflow, WorkflowGenerator, WorkflowHash,
    TaskHash, TaskError,
    Statuses, TaskStatus, WorkflowStatus,
    ControllerInterface,
} from './index.d';
import { Redis } from './redis';
import { ExecutionErrorType } from './common';

const Promise = require('bluebird');

import { update } from './immutability';

/**
 * Manage workflow tasks.
 *
 * To each task of a workflow instance corresponds a redis hash : "workflowTask_<workflowId>_<taskPath>",
 * with the following  keys :
 *    - status : Status
 *    - body : JSON string (either a result or an error)
 *    - executionTime : number (last execution)
 */
export class Controller implements ControllerInterface
{
    private generators : {
        [name : string] : WorkflowGenerator;
    };
    private redis : Redis;
    private io;
    private jobs : Jobs;

    public constructor(redis, jobs : Jobs)
    {
        this.generators = {};
        this.redis = redis;
        this.jobs = jobs;
        this.io = null;

        jobs.registerController(this);
    }

    public registerSockets(io)
    {
        this.io = io;
    }

    /**
     * Create a workflow generator. This allows to create a custom tasks schema from any data.
     */
    public registerWorkflowGenerator(name : string, generator : WorkflowGenerator)
    {
        this.generators[name] = generator;
    }

    /**
     * Call a generator to create the workflow tasks.
     *
     * TODO cache result ?
     */
    public generateWorkflow(generator : string, data : any, workflowId : string) : Promise<Workflow>
    {
        if (this.generators[generator] == null) {
            throw new Error('Unknow workflow generator : ' + generator);
        } else {
            let workflowPromise = this.generators[generator](data);
            if ((workflowPromise as Promise<Workflow>).then == null) {
                workflowPromise = Promise.resolve(workflowPromise);
            }
            return (workflowPromise as Promise<Workflow>).then(workflow => {
                workflow.id = workflowId;
                workflow.redis = this.redis;
                return workflow;
            });
        }
    }

    /**
     * Mark the task as queued, and then execute eit and register listeners to broadcast results
     * through the websockets.
     */
    public executeOneTask(workflowId : string, taskPath : string, callerSocket = null)
    {
        let self = this;
        return this.redis.setTaskStatus(workflowId, taskPath, 'queued')
                   .then(() => {
                       return this.jobs.runTask(workflowId, taskPath)
                                  .on('complete', function (taskHash : TaskHash) {
                                      self.sendTasksStatuses(workflowId, {
                                          [taskPath]: {
                                              status: 'ok',
                                              ... (taskHash as any),
                                          },
                                      });
                                  })
                                  .on('failed', function (err : TaskError) {
                                      self.sendTasksStatuses(workflowId, {
                                          [taskPath]: {
                                              status: 'failed',
                                              ... err.payload
                                          },
                                      });
                                  })
                                  .on('error', function (err) {
                                      if (callerSocket != null) {
                                          callerSocket.emit('executionError', err);
                                      }
                                  });
                   });
    }

    /**
     * If a websocket server is registered, dispatch statuses update.
     */
    private sendTasksStatuses(workflowId : string, statuses : Statuses)
    {
        if (this.io != null) {
            this.io.sockets.in(workflowId)
                .emit('setTasksStatuses', {
                    id: workflowId,
                    statuses,
                });
        }
    }

    public finishWorkflow(workflowId : string)
    {
        this.redis.setWorkflowStatus(workflowId, 'done' as WorkflowStatus);

        if (this.io != null) {
            this.io.sockets.in(workflowId)
                .emit('setWorkflowStatus', {
                    id: workflowId,
                    status: 'done' as WorkflowStatus
                });
        }
    }

    /**
     * Run a SINGLE task of a workflow instance.
     *
     * Return a promise resolving to the result of this task.
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
        return this.redis.getWorkflow(workflowId)
                   .then((workflowHash : WorkflowHash) => {
                       return this.generateWorkflow(workflowHash.generator, workflowHash.generatorData,
                           workflowId)
                                  .then(workflow => {
                                      return workflow.getTask(path, baseContext)
                                                     .then(res => {
                                                         let {task, context, prevResult} = res;
                                                         if (argument == null) {
                                                             argument = prevResult;
                                                         }

                                                         /**
                                                          * Actual execution of the task
                                                          */

                                                         if (task.condition != null) {
                                                             if (!task.condition(context)) {
                                                                 // Bypass this task, and mark it as executed
                                                                 let taskHash = {
                                                                     status: 'ok' as TaskStatus,
                                                                     argument,
                                                                     context,
                                                                     body: {message: 'Task skipped'},
                                                                     contextUpdaters: [],
                                                                     executionTime: currentDate.getTime(),
                                                                 };
                                                                 return self.redis.setTask(workflow.id, path, taskHash);
                                                             }
                                                         }

                                                         let contextUpdaters = [];
                                                         let callingContext = context; // The "received" context before executing the task callback
                                                         let factory = {
                                                             /**
                                                              * Run other tasks
                                                              */
                                                             controller: self,

                                                             /**
                                                              * Read only context.
                                                              */
                                                             context,

                                                             /**
                                                              * Pure functional : no side effects. The updater is also serialized in the redis database.
                                                              */
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
                                                             /**
                                                              * Update or create a sequelize entity.
                                                              */
                                                             saveInstance(model, data)
                                                             {
                                                                 if (data.id == null) {
                                                                     // Create a new instance.
                                                                     return model.create(data);
                                                                 } else {
                                                                     if (data.save != null) {
                                                                         // Data is already an instanc3
                                                                         return data.save();
                                                                     } else {
                                                                         return model.findById(data.id)
                                                                                     .then(instance => {
                                                                                         return instance.update(data);
                                                                                     });
                                                                     }
                                                                 }
                                                             },
                                                         };
                                                         try {
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
                                                                        .then(res => {
                                                                            // Middleware to perform operations with the task result

                                                                            if (task.onComplete != null) {
                                                                                // TODO logging
                                                                                console.log(task.onComplete);
                                                                            }

                                                                            if (task.debug != null) {
                                                                                task.debug(res, factory.context);
                                                                            }

                                                                            // Update the task hash
                                                                            let taskHash = {
                                                                                status: 'ok' as TaskStatus,
                                                                                argument,
                                                                                context: callingContext,
                                                                                body: res || null,
                                                                                contextUpdaters,
                                                                                executionTime: currentDate.getTime(),
                                                                            };
                                                                            return self.redis.setTask(workflow.id, path,
                                                                                taskHash);
                                                                        });
                                                         }
                                                         catch (err) {
                                                             console.log(err);
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
}

