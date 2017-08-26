declare function createWorkflowInstance(workflowGenerator: string, workflowData: any, baseContext ?: any, execute ?: boolean) : Promise<string>;
declare function updateWorkflow(workflowId : string, workflowUpdater : any) : Promise<{}>;
declare function executeAllTasks(tasks : Task[], workflowId : string, startPath ?: string, callerSocket ?: any);
declare function setupWebsockets(server : any);
declare function registerWorkflowGenerator(name : string, generator : WorkflowGenerator);

type TaskStatus = "inactive" | "queued" | "ok" | "failed";
type WorkflowStatus = "working" | "done";

export namespace Tasks {
  export interface TreeTask extends Task {
    task : { (arg : any, factory : Factory) : Promise<any> };
    children : TreeTask[];
  }
}

export namespace Workflows {
  export class TreeWorkflow {
    constructor(tasks : Tasks.TreeTask[]);
  }
}

export interface WorkflowTreeTasks {
    [i: number]: {
        name: string; // Task name;
        description: string;
        path: string; // Full task path
        children?: WorkflowTreeTasks;
    };
}

export interface Statuses {
    [taskPath : string]: {
      status: TaskStatus;
      body: any;
      context : any;
      argument : any;

      executionTime ?: number;
    };
}

declare interface ControllerInterface
{
  executeOneTask(workflowId : string, taskPath : string, callerSocket ?: any);
  run(workflowId : string, path ?: string, baseContext ?: any, argument ?: any): Promise<any>;
  finishWorkflow(workflowId : string);
}

export interface Task {
  name: string;
  description ?: string;

  contextVar ?: string; // If set, the task result will be added to the future contexts.

  condition ?: { (context): boolean; };
  /**
   * If set, this callback is executed with the task result and task context.
   * The context does not contain the result, even if "contextVar" is set.
   */
  debug ?: { (res, debug): void; };
  onComplete ?: string;

  /**
   * Do not edit the context directly !
   * Use the udpateContext() function of the factory.
   */
  execute(arg, factory : Factory) : Promise<any>;
}

export abstract class BaseTask implements Task
{
  public name;
  public description;
  public contextVar;
  public execute(arg, factory);
}

interface Factory {
  controller: ControllerInterface;
  context : any;

  updateContext(updater : any): void;
  saveInstance(model, data);
}


export interface Workflow
{
  redis: any;
  id : string;

  getTask(path: string, baseContext): Promise<{
      context: { [varName: string]: any; };
      task: Task;
      prevResult: any,
    }>;

  /**
   * Flatten all task paths of a workflow.
   */
  getAllPaths() : string[];

  /**
   * Get a description of the workflow tasks.
   */
  describe() : {tasks: WorkflowTreeTasks;};

  /**
   * Execute the whole workflow (until error)
   */
  execute(controller : ControllerInterface, callerSocket : any) : void;
}

export interface TaskError {
  type: string;
  payload: {
    body: any; // The error description

    argument : any;
    context : any;
  };
}

export interface WorkflowGenerator {
  (data : any) : Workflow;
}

export interface WorkflowHash {
  status: WorkflowStatus;

  baseContext: any;
  
  generator: string;
  generatorData: any;
}

export interface TaskHash {
  // Result
  status: TaskStatus;
  body: any;
  executionTime: number;

  // Execution context
  argument: any;
  context: any;

  // During execution
  contextUpdaters ?: any[];
}

