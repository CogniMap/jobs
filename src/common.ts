import { Task } from './index.d';

export namespace ExecutionErrorType {
  export const CANNOT_FIND_TASK = 'CANNOT_FIND_TASK'; 
  export const CANNOT_START_TASK = 'CANNOT_START_TASK';  // Could not start the excution of the task
  export const SCHEDULER_ERROR = 'SCHEDULER_ERROR';    // Could not find what to do for that task configuration
  export const EXECUTION_FAILED = 'EXECUTION_FAILED';  // The task execution failed
}

export abstract class BaseTask implements Task
{
  public name;
  public description;
  public contextVar;
  public abstract execute(arg, factory);
}

