const Promise = require('bluebird');

import { Redis } from '../redis';
import { BaseWorkflow } from './workflow';
import {
  WorkflowTreeTasks,
  BaseTask,
  ExecutionErrorType, Factory,
} from '../index.d';
import { promisesFor } from '../promises';
import { update } from '../immutability';

class TreeTask extends BaseTask
{
  public task : { (arg: any, factory) : Promise<any>; };
  public children: TreeTask[];

  public execute(arg, factory : Factory) 
  {
    return this.task(arg, factory);
  }
}

/**
 * A tree of tasks.
 * Children tasks are executed in parallels.
 *
 * Paths are json-paths in the tree. The root level is '#'
 */
export class TreeWorkflow extends BaseWorkflow
{
  private tasks : TreeTask[];

  public constructor(tasks) {
    super();
    this.tasks = tasks;
  }

  public getTask(path : string, baseContext)
  {
    let self = this;
    function _getTask(tasks: TreeTask[], targetPath: string, currentContext = {}, prevResult = {}, currentPath = '#', minExecutionTime: number = 0): Promise<{
      context: { [varName: string]: any; };
      task: Task;
      prevResult: any,
    }> {
      return promisesFor(tasks, (i, task : TreeTask, breakFor, continueFor) => {
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
              payload: 'Missing task "' + targetPath + '"'
            });
          } else {
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
          }
        }

        // Find the result for this task
        return self.redis.getTask(self.id, taskPath)
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

    return _getTask(this.tasks, path, baseContext);
  }

  public describe() : {tasks: WorkflowTreeTasks;}
  {
    function describeTasks(tasks: TreeTask[], pathPrefix = '#') : WorkflowTreeTasks
    {
      return tasks.map(task => {
        return {
          name: task.name,
          path: pathPrefix + '.' + task.name,
          children: describeTasks(task.children, pathPrefix + '.' + task.name)
        };
      })
    }

    return {
      tasks: describeTasks(this.tasks)
    };
  }

  public getAllPaths() : string[]
  {
    function getPaths(tasks: TreeTask[], pathPrefix = '#') {
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
}
