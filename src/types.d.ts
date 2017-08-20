type Status = "inactive" | "queued" | "ok" | "failed";

export interface WorkflowTasks {
    [i: number]: {
        name: string; // Task name;
        path: string; // Full task path
        children?: WorkflowTasks;
    };
}

export interface Statuses {
    [taskPath : string]: {
      status: Status;
      body: any;
      context : any;
      argument : any;

      executionTime ?: number;
    };
}

declare namespace ExecutionErrorType {
  export const CANNOT_FIND_TASK = 'CANNOT_FIND_TASK'; 
  export const CANNOT_START_TASK = 'CANNOT_START_TASK';  // Could not start the excution of the task
  export const SCHEDULER_ERROR = 'SCHEDULER_ERROR';    // Could not find what to do for that task configuration
  export const EXECUTION_FAILED = 'EXECUTION_FAILED';  // The task execution failed
}

export interface TaskError {
  type: string;
  payload: {
    body: any; // The error description

    argument : any;
    context : any;
  };
}

export enum TaskType {
  SINGLE = 1,
  PARALLELS=  2,
}

export interface Task {
  type: TaskType,
  name: string;

  contextVar ?: string; // If set, the task result will be added to the future contexts.

  condition ?: { (context): boolean; };
  /**
   * If set, this callback is executed with the task result and task context.
   * The context does not contain the result, even if "contextVar" is set.
   */
  debug ?: { (res, debug): void; };
  onComplete ?: string;
}

export interface WorkflowGenerator {
  (data : any) : Task[];
}

export interface WorkflowHash {
  baseContext: any;
  
  generator: string;
  generatorData: any;
}

export interface TaskHash {
  // Result
  status: Status;
  body: any;
  executionTime: number;

  // Execution context
  argument: any;
  context: any;

  // During execution
  contextUpdaters ?: any[];
}

