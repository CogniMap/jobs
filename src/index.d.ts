export interface RedisConfig
{
    host : string;
    port ?: number;
}

export interface MysqlConfig
{
    host: string;
    port ?: number;
    username: string;
    password: string;
}

declare class Jobs
{
    public constructor(redisConfig : RedisConfig, mysqlConfig : MysqlConfig);

    public createWorkflowInstance(workflowGenerator : string, workflowData : any, baseContext ? : any,
                                  execute ? : boolean) : Promise<string>;

    public updateWorkflow(workflowId : string, workflowUpdater : any) : Promise<{}>;

    public executeAllTasks(tasks : Task[], workflowId : string, startPath ? : string, callerSocket ? : any);

    public setupWebsockets(server : any);

    public registerWorkflowGenerator(name : string, generator : WorkflowGenerator);

    public getAllWorkflows() : Promise<WorkflowInstance[]>;
}

/**
 * An instance in the sequelize database.
 */
export interface WorkflowInstance
{
    id : string;
    name: string;
}

type TaskStatus = 'inactive' | 'queued' | 'ok' | 'failed';
type WorkflowStatus = 'working' | 'done';

export namespace Tasks
{
    export interface TreeTask extends Task
    {
        children : TreeTask[];
    }
}

export namespace Workflows
{
    export class TreeWorkflow
    {
        constructor(tasks : Tasks.TreeTask[]);
    }
}

export interface WorkflowTreeTasks
{
    [i : number] : {
        name : string; // Task name;
        description : string;
        path : string; // Full task path
        children? : WorkflowTreeTasks;
    };
}

export interface Statuses
{
    [taskPath : string] : {
        status : TaskStatus;
        body : any;
        context : any;
        argument : any;
        contextUpdaters : any;

        executionTime ? : number;
    };
}

declare interface ControllerInterface
{
    executeOneTask(workflowId : string, taskPath : string, callerSocket ? : any);

    run(workflowId : string, path ? : string, baseContext ? : any, argument ? : any) : Promise<any>;

    finishWorkflow(workflowId : string);
}

export interface Task
{
    name : string;
    description ? : string;

    contextVar ? : string; // If set, the task result will be added to the future contexts.

    condition ? : {(context) : boolean;};
    /**
     * If set, this callback is executed with the task result and task context.
     * The context does not contain the result, even if "contextVar" is set.
     */
    debug ? : {(res, debug) : void;};
    onComplete ? : string;

    /**
     * Do not edit the context directly !
     * Use the udpateContext() function of the factory.
     */
    execute ? : {(arg, factory : Factory) : Promise<any>;};
}

interface Factory
{
    controller : ControllerInterface;
    context : any;
    previousContext: any;

    updateContext(updater : any) : void;

    saveInstance(model, data);
}


export interface Workflow
{
    redis : any;
    id : string;

    getTask(path : string, baseContext) : Promise<{
        context : {[varName : string] : any;};
        resultContext : {[varName : string] : any;};
        task : Task;
        prevResult : any,
    }>;

    /**
     * Flatten all task paths of a workflow.
     */
    getAllPaths() : string[];

    /**
     * Get a description of the workflow tasks.
     */
    describe() : {tasks : WorkflowTreeTasks;};

    /**
     * Execute the whole workflow (until error)
     */
    execute(controller : ControllerInterface, callerSocket : any) : void;
}

export interface TaskError
{
    type : string;
    payload : {
        body : any; // The error description

        argument : any;
        context : any;
    };
}

export interface WorkflowGenerator
{
    (data : any) : Workflow | Promise<Workflow>;
}

export interface WorkflowHash
{
    status : WorkflowStatus;

    baseContext : any;

    generator : string;
    generatorData : any;
}

export interface TaskHash
{
    // Result
    status : TaskStatus;
    body : any;
    executionTime : number;

    // Execution context
    argument : any;
    context : any;

    // During execution
    contextUpdaters ? : any[];
}

