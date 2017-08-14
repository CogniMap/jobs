export type Status = "inactive" | "queued" | "ok" | "failed";

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
    };
}

export namespace ExecutionErrorType {
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
