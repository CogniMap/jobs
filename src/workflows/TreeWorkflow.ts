const Promise = require('bluebird');

import { TaskWatcher } from '../backends/watcher';
import { BaseWorkflow } from './BaseWorkflow';
import {
    ControllerInterface,
    WorkflowTreeTasks,
    Tasks, TaskHash,
} from '../index.d';
import { getResultContext } from './context';
import { ExecutionErrorType } from '../common';
import { promisesFor } from '../promises';


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

    /**
     * @inheritDoc
     */
    public getTask(path : string, baseContext,
                   getTaskHash : {(workflowId : string, taskPath : string) : Promise<TaskHash>})
    {
        let self = this;

        function _getTask(tasks : Tasks.TreeTask[], targetPath : string, currentContext = {}, prevResult = {},
                          currentPath = '#', minExecutionTime : number = 0) : Promise<{
            context : {[varName : string] : any;};
            resultContext : {[varName : string] : any;};
            task : Tasks.TreeTask;
            prevResult : any,
        }>
        {
            return promisesFor(tasks, (i, task : Tasks.TreeTask, breakFor, continueFor) => {
                let taskPath = currentPath + '.' + task.name;
                if (taskPath == targetPath) {
                    return getTaskHash(self.id, taskPath)
                        .then(taskHash => {
                            let resultContext = getResultContext(taskHash, currentContext);
                            return breakFor({
                                task, prevResult,
                                context: currentContext,
                                resultContext,
                            });
                        });
                } else if ((targetPath as any).startsWith(taskPath)) {
                    if (task.children.length == 0) {
                        return Promise.reject({
                            type: ExecutionErrorType.CANNOT_FIND_TASK,
                            payload: 'Missing task "' + targetPath + '"',
                        });
                    } else {
                        // TODO go deeper
                        return Promise.reject({
                            type: ExecutionErrorType.SCHEDULER_ERROR,
                            payload: 'Parallels not supported yet (getTask)',
                        });
                    }
                }

                // Find the result for this task
                return getTaskHash(self.id, taskPath)
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
                        currentContext = getResultContext(taskHash, currentContext);
                    });
            });
        }

        return _getTask(this.tasks, path, baseContext);
    }

    /**
     * @inheritDoc
     */
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

    /**
     * @inheritDoc
     */
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

    /**
     * @inheritDoc
     */
    public execute(controller : ControllerInterface, argument = null) : Promise<any>
    {
        let self = this;
        let startTask = '#.' + this.tasks[0].name;

        function executeNextTask(path : string, argument = null)
        {
            return controller.executeOneTask(self.id, path, argument)
                      .then((taskHash) => {
                          try {
                              let nextPath = self.getNextTask(path);
                              return executeNextTask(nextPath);

                          }
                          catch (e) {
                              if (e === 'NoNextTask') {
                                  controller.finishWorkflow(self.id);
                              } else {
                                  return Promise.reject(e);
                              }
                          }
                      });
        }

        return executeNextTask(startTask, argument);
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
