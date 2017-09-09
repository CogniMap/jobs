const Promise = require('bluebird');

import { Redis } from '../redis';
import { BaseWorkflow } from './workflow';
import {
    WorkflowTreeTasks,
    Tasks,
    ControllerInterface, Factory,
} from '../index.d';
import { BaseTask, ExecutionErrorType } from '../common';
import { promisesFor } from '../promises';
import { update } from '../immutability';


/**
 * A tree of tasks.
 * Children tasks are executed in parallels.
 *
 * Paths are json-paths in the tree. The root level is '#'
 */
export class TreeWorkflow extends BaseWorkflow
{
    private tasks : Tasks.TreeTask[];

    public constructor(tasks)
    {
        super();
        this.tasks = tasks;
    }

    public getTask(path : string, baseContext)
    {
        let self = this;

        function _getTask(tasks : Tasks.TreeTask[], targetPath : string, currentContext = {}, prevResult = {},
                          currentPath = '#', minExecutionTime : number = 0) : Promise<{
            context : {[varName : string] : any;};
            task : Tasks.TreeTask;
            prevResult : any,
        }>
        {
            return promisesFor(tasks, (i, task : Tasks.TreeTask, breakFor, continueFor) => {
                let taskPath = currentPath + '.' + task.name;
                if (taskPath == targetPath) {
                    return breakFor({
                        task, prevResult,
                        context: currentContext,
                    });
                } else if ((targetPath as any).startsWith(taskPath)) {
                    if (task.children.length == 0) {
                        return Promise.reject({
                            type: ExecutionErrorType.CANNOT_FIND_TASK,
                            payload: 'Missing task "' + targetPath + '"',
                        });
                    } else {
                        // TODO
                        return Promise.reject({
                            type: ExecutionErrorType.SCHEDULER_ERROR,
                            payload: 'Parallels not supported yet (getTask)',
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
                    }
                }

                // Find the result for this task
                return self.redis.getTask(self.id, taskPath)
                           .then(taskHash => {
                               // Make sure this task was executed after the previous ones, and was successfull
                               if (taskHash.status != 'ok') {
                                   return Promise.reject({
                                       type: ExecutionErrorType.CANNOT_START_TASK,
                                       payload: 'The task "' + taskPath + '" need to be re-executed (Current status is : "' + taskHash.status + '")',
                                   });
                               }
                               if (taskHash.executionTime < minExecutionTime) {
                                   return Promise.reject({
                                       type: ExecutionErrorType.CANNOT_START_TASK,
                                       payload: 'The task "' + taskPath + '" need to be re-executed (previous tasks have been executed afterward)',
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

        return _getTask(this.tasks, path, baseContext);
    }

    public describe() : {tasks : WorkflowTreeTasks;}
    {
        function describeTasks(tasks : Tasks.TreeTask[], pathPrefix = '#') : WorkflowTreeTasks
        {
            return tasks.map(task => {
                return {
                    name: task.name,
                    description: task.description,
                    path: pathPrefix + '.' + task.name,
                    children: describeTasks(task.children, pathPrefix + '.' + task.name),
                };
            });
        }

        return {
            tasks: describeTasks(this.tasks),
        };
    }

    public getAllPaths() : string[]
    {
        function getPaths(tasks : Tasks.TreeTask[], pathPrefix = '#')
        {
            let paths = [];
            for (let task of tasks) {
                let taskPath = pathPrefix + '.' + task.name;
                paths.push(taskPath);
                paths.concat(getPaths(task.children, taskPath));
            }
            return paths;
        }

        return getPaths(this.tasks);
    }

    public execute(controller : ControllerInterface, callerSocket = null) : void
    {
        let self = this;

        function executeNextTask(path : string)
        {
            controller.executeOneTask(self.id, path, callerSocket)
                      .then((jobEvents : any) => {
                          jobEvents.on('complete', function (res) {
                              try {
                                  let nextPath = self.getNextTask(path);
                                  executeNextTask(nextPath);

                              }
                              catch (e) {
                                  if (e === 'NoNextTask') {
                                      controller.finishWorkflow(self.id);
                                  } else {
                                      throw e;
                                  }
                              }
                          });
                      });
        }

        executeNextTask('#.' + this.tasks[0].name);
    }

    /**
     * Get the next task path in the tree
     */
    public getNextTask(taskPath : string)
    {
        let self = this;

        /**
         * When the target task is found :
         *  - If it is not the last task of the tasks array, return the next one
         *  - Else, return the next task of the parent. If we are at the root level (ie parentPath == '#'),
         *  throw a "NoNextTask" exception.
         */
        function aux(tasks : Tasks.TreeTask[], targetPath, parentPath = '#')
        {
            for (let i = 0; i < tasks.length; i++) {
                let task = tasks[i];
                let taskPath = parentPath + '.' + task.name;
                if (taskPath == targetPath) {
                    if (i < tasks.length - 1) {
                        return parentPath + '.' + tasks[i + 1].name;
                    } else {
                        if (parentPath == '#') {
                            throw 'NoNextTask';
                        } else {
                            return self.getNextTask(parentPath);
                        }
                    }
                } else if (targetPath.startsWith(taskPath)) {
                    if (task.children.length > 0) {
                        return aux(task.children, targetPath, taskPath);
                    } else {
                        throw new Error('Missing task : "' + targetPath + '" !');
                    }
                } else {
                    continue;
                }
            }
        }

        return aux(this.tasks, taskPath);
    }
}
