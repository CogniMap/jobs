import { WorkflowTreeTasks, Task, Workflow } from '../index.d';
import { Redis } from '../redis';

export abstract class BaseWorkflow implements Workflow
{
  public id : string;
  public redis : Redis;

  public abstract getTask(path: string, baseContext): Promise<{
      context: { [varName: string]: any; };
      task: Task;
      prevResult: any,
    }>;
  public abstract getAllPaths() : string[];
  public abstract describe() : {tasks: WorkflowTreeTasks;};
}
