import {Jobs} from './jobs';
import {
  WorkflowGenerator, WorkflowHash,
  TaskType, Task, WorkflowTasks,
  ExecutionErrorType,
  Statuses, Status
} from './types';
import { Redis } from './redis';
import { promisesFor } from './promises';
const Promise = require('bluebird');

import { update } from './immutability';

interface Factory {
  context : any;

  updateContext(updater : any): void;
  saveInstance(model, data);
}

/**
 * For all functions :
 * @param res is the result of the previous task
 * @param context is the task context
 */
export interface SingleTask extends Task {
  /**
   * Do not edit the context directly !
   * Use the udpateContext() function of the factory.
   */
  task: {
    (res, factory): Promise<any>|any;
  };
}

export interface ParallelsTasks extends Task {
  subTasks: Task[];
}

/**
 * Manage workflow tasks.
 *
 * To each task of a workflow instance corresponds a redis hash : "workflowTask_<workflowId>_<taskPath>",
 * with the following  keys :
 *    - status : Status
 *    - body : JSON string (either a result or an error)
 *    - executionTime : number (last execution)
 */
export class Controller {
  private generators: {
    [name: string]: WorkflowGenerator;
  };
  private redis : Redis;
  private io;
  private jobs: Jobs;

  public constructor(redis) {
    this.generators = {};
    this.redis = redis;
  }

  /**
   * Create a workflow generator. This allows to create a custom tasks schema from any data.
   */
  public registerWorkflowGenerator(name: string, generator : WorkflowGenerator)
  {
    this.generators[name] = generator;
  }

  /**
   * Call a generator to create the workflow tasks.
   *
   * TODO cache result ?
   */
  public generateWorkflow(generator : string, data : any) : Task[]
  {
    if (this.generators[generator] == null) {
      throw new Error('Unknow workflow generator : ' + generator);
    } else {
      return this.generators[generator](data);
    }
  }

  /**
   * Get the next task path for the given workflow.
   */
  public getNextTask(workflowTasks: Task[], taskPath: string)
  {
    let self = this;

    /**
     * When the target task is found :
     *  - If it is not the last task of the tasks array, return the next one
     *  - Else, return the next task of the parent. If we are at the root level (ie parentPath == '#'),
     *  throw a "NoNextTask" exception.
     */
    function aux(tasks: Task[], targetPath, parentPath = '#') {
      for (let i = 0; i < tasks.length; i++) {
        let task = tasks[i];
        let taskPath = parentPath + '.' + task.name;
        if (taskPath == targetPath) {
          if (i < tasks.length - 1) {
            return parentPath + '.' + tasks[i + 1].name;
          } else {
            if (parentPath == '#') {
              throw "NoNextTask";
            } else {
              return self.getNextTask(workflowTasks, parentPath);
            }
          }
        } else if (targetPath.startsWith(taskPath)) {
          switch (task.type) {
            case TaskType.SINGLE:
              throw new Error('Missing task : "' + targetPath + '" !');
            case TaskType.PARALLELS:
              return aux((task as ParallelsTasks).subTasks, targetPath, taskPath);
            }
        } else {
          continue;
        }
      }
    }

    return aux(workflowTasks, taskPath);
  }

  /**
   * Run a SINGLE task of a workflow instance.
   *
   * Return a promise resolving to the result of this task.
   */
  public run(workflowId : string, path = '#', baseContext = {}, argument = null): Promise<any> {
    let self = this;

    /**
     * Traverse the workflow and fill the context with previous result.
     * If a result is missing, throw an error.
     *
     * Return the task whith the given @param path.
     *
     * @param currentContext The future task context, build recursively
     */
    function getTask(tasks: Task[], targetPath: string, currentContext = {}, prevResult = {}, currentPath = '#', minExecutionTime: number = 0): Promise<{
      context: { [varName: string]: any; };
      task: Task;
      prevResult: any,
    }> {
      return promisesFor(tasks, (i, task, breakFor, continueFor) => {
        let taskPath = currentPath + '.' + task.name;
        if (taskPath == targetPath) {
          return breakFor({
            task, prevResult,
            context: currentContext,
          });
        } else if ((targetPath as any).startsWith(taskPath)) {
          if (task.type == TaskType.SINGLE) {
            return Promise.reject({
              type :ExecutionErrorType.CANNOT_FIND_TASK,
              payload: 'Missing task "' + targetPath + '"'
            });
          } else if (task.type == TaskType.PARALLELS) {
            // TODO
            return Promise.reject({
              type: ExecutionErrorType.SCHEDULER_ERROR,
              payload: 'Parallels not supported yet (getTask)'
            });
            // Go deeper
            //return getTask(
            //  taskWithSubtasks.subTasks,
            //  targetPath,
            //  Object.assign({}, currentPromiseContext, {
            //    [taskWithSubtasks.dest]: taskResult
            //  }),
            //  taskPath,
            //  taskHash.executionTime
            //  );
          } else {
            return Promise.reject({
              type: ExecutionErrorType.SCHEDULER_ERROR,
              payload: 'Unknow task type : ' + task.type
            });
          }
        }

        // The current task is a dependency

        // Find the result for this task
        let taskKey = 'task_' + workflowId + '_' + taskPath;
        return self.redis.getTask(workflowId, taskPath)
          .then(taskHash => {
            // Make sure this task was executed after the previous ones, and was successfull
            if (taskHash.status != "ok") {
              return Promise.reject({
                type: ExecutionErrorType.CANNOT_START_TASK,
                payload: 'The task "' + taskPath + '" need to be re-executed (Current status is : "' + taskHash.status + '")'
              });
            }
            if (taskHash.executionTime < minExecutionTime) {
              return Promise.reject({
                type: ExecutionErrorType.CANNOT_START_TASK,
                payload: 'The task "' + taskPath + '" need to be re-executed (previous tasks have been executed afterward)'
              });
            }
            minExecutionTime = taskHash.executionTime;
            prevResult = taskHash.body;

            // Update the context
            if (task.contextVar != null) {
              currentContext[task.contextVar] = prevResult;
            }
            for (let updater of taskHash.contextUpdaters) {
              currentContext = update(currentContext, updater);
            }
          });
      });
    }

    let currentDate = new Date();
    return this.redis.getWorkflow(workflowId)
      .then((workflowHash : WorkflowHash) => {
        let tasks = self.generateWorkflow(workflowHash.generator, workflowHash.generatorData);
        return getTask(tasks, path, baseContext)
          .then(res => {
            let {task, context, prevResult} = res;
            if (argument == null) {
              argument = prevResult;
            }

            /**
             * Actual execution of the task
             */

            if (task.condition != null) {
              if (! task.condition(context)) {
                // Bypass this task, and mark it as executed
                let taskHash = {
                  status: 'ok' as Status,
                  argument,
                  context,
                  body: {message: 'Task skipped'},
                  contextUpdaters: [],
                  executionTime: currentDate.getTime(),
                };
                return self.redis.setTask(workflowId, path, taskHash);
              }
            }

            switch (task.type) {
              case TaskType.PARALLELS:
                // TODO
                return Promise.reject({
                  type: ExecutionErrorType.SCHEDULER_ERROR,
                  payload: {
                    body: 'Parallels not supported yet',
                    argument, context,
                  },
                });
              case TaskType.SINGLE:
                let contextUpdaters = [];
                let callingContext = context; // The "received" context before executing the task callback
                let factory = {
                  /**
                   * Read only context.
                   */
                  context,

                  /**
                   * Pure functional : no side effects. The updater is also serialized in the redis database.
                   */
                  updateContext(updater) {
                    contextUpdaters.push(updater);
                    try {
                      this.context = update(this.context, updater);
                    } catch (e) {
                      // TODO return  ExecutionErrorType.CONTEXT_UPDATE
                      console.log(e);
                    }
                  },
                  /**
                   * Update or create a sequelize entity.
                   */
                  saveInstance(model, data) {
                    if (data.id == null) {
                      // Create a new instance.
                      return model.create(data);
                    } else {
                      return model.findById(data.id)
                        .then(instance => {
                          return instance.update(data);
                        });
                    }
                  }
                };
                try {
                  return (task as SingleTask).task(argument, factory)
                    .catch(err => {
                      return Promise.reject({
                        type: ExecutionErrorType.EXECUTION_FAILED,
                        payload: {
                          body: err,
                          argument,
                          context: callingContext,
                          contextUpdaters,
                        }
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
                        status: 'ok' as Status,
                        argument,
                        context: callingContext,
                        body: res || null,
                        contextUpdaters,
                        executionTime: currentDate.getTime(),
                      };
                      return self.redis.setTask(workflowId, path, taskHash);
                    });
                } catch (err) { 
                  // Direct exception in the task callback
                  return Promise.reject({
                    type: ExecutionErrorType.EXECUTION_FAILED,
                    payload: {
                      body: typeof err == 'string' ? err : err.toString(),
                      argument,
                      context: callingContext,
                    }
                  });
                }
            }
          });
      });
  }

  /**
   * Flatten all task paths of a workflow.
   */
  public getTasksPaths(workflowTasks : Task[]) : string[]
  {
    function getPaths(tasks: Task[], pathPrefix = '#') {
      let paths = [];
      for (let task of tasks) {
        let taskPath = pathPrefix + '.' + task.name;
        paths.push(taskPath);
        if ((task as any).subTasks != null) {
          paths.concat(getPaths((task as any).subTasks, taskPath));
        }
      }
      return paths;
    }

    return getPaths(workflowTasks);
  }

  /**
   * Describe a workflow for a client (ie list tasks etc).
   */
  public describeWorkflow(workflowTasks : Task[]) : {tasks: WorkflowTasks;}
  {
    function describeTasks(tasks: Task[], pathPrefix = '#') : WorkflowTasks
    {
      return tasks.map(task => {
        return {
          name: task.name,
          path: pathPrefix + '.' + task.name,
          children: (task as any).subTasks == null ? [] : describeTasks((task as any).subTasks, pathPrefix + '.' + task.name)
        };
      })
    }

    return {
      tasks: describeTasks(workflowTasks)
    };
  }
}

/**
 * Testing :
 */
//const testTasks_1 = [
//  {
//  task: () => {
//    return Promise.resolve(1);
//  },
//  onComplete: (i) => ("Number complete (" + i + ")"),
//  subTasks: (i) => [
//    {
//    task: () => Promise.resolve(2),
//    onComplete: (ii) => 'Sub gave : ' + i + ii,
//    }
//  ]
//  }, {
//  task: (i) => {
//    return Promise.resolve('test ' + i);
//  },
//  onComplete: (s) => ("String complete (" + s + ")")
//  }, {
//  task: (s) => {
//    return Promise.resolve();
//  },
//  }
//];
//run(testTasks_1, BackendType.CONSOLE);
