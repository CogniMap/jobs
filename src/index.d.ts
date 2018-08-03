/******************************************************************************
 * Controllers
 ******************************************************************************/

export interface ControllerConfiguration {
    onError?: WorkflowErrorHandler;
}

export interface WebsocketControllerConfig {
    server: any;
}

export interface ControllerInterface {
    executeOneTask(workflowId: string, taskPath: string, argument ?: any): Promise<TaskHash>;

    executeAllTasks(workflowId: string, argument ?: any): Promise<{}>;

    finishWorkflow(workflowId: string);
}

/******************************************************************************
 * Storages
 ******************************************************************************/

export interface StorageConfig {
    type: "redis" | "dynamodb";
}

export interface RedisConfig extends StorageConfig {
    host: string;
    port?: number;
}

export interface DynamodbConfig extends StorageConfig {
    region: string;
    tableName: string;
    
    awsCredentials ?: {
        keyId: string;
        secret: string;
    }
}

/******************************************************************************
 * Backends
 ******************************************************************************/

export interface BackendConfiguration {
    tasksStorage: StorageConfig;
    redis: {      // For the queue
        host: string;
        port?: number;
    };
    onDeleteWorkflow ?: DeleteWorkflowHandler;
}

export interface DynamodbTasksConfig extends StorageConfig {
    tableName: string;
}

export interface SyncBackendConfiguration extends BackendConfiguration {
}

export interface AsyncBackendConfiguration extends BackendConfiguration {
}

interface Factory<T>
{
    context : T;
    previousContext : T;

    updateContext(updater: any): void;

    saveInstance(model, data);
}

declare interface BackendInterface {
    registerWorkflowGenerator(name: string, generator: WorkflowGenerator);

    executeOneTask(workflowId: string, taskPath: string, callerSocket ?: any, argument ?: any)
}


/******************************************************************************
 * Main Jobs object
 ******************************************************************************/

declare class Jobs {
    public static BACKEND_ASYNC: string;
    public static BACKEND_SYNC: string;

    public static CONTROLLER_BASE: string;
    public static CONTROLLER_WEBSOCKET: string;

    public constructor(backend: {
        type: string,
        config: BackendConfiguration
    }, controller: {
        type: string,
        config: ControllerConfiguration
    });

    public createWorkflowInstance(realm: string, workflowGenerator: string, workflowData: any, options ?: {
        baseContext?: any,
        ephemeral?: boolean,
        execute?: boolean,
        name?: string
    }): Promise<string>;

    public updateWorkflow(workflowId: string, workflowUpdater: any): Promise<{}>;

    public executeAllTasks(workflowId: string, argument ?: any): Promise<any>;

    public registerWorkflowGenerator(name: string, generator: WorkflowGenerator);

    public getAllWorkflows(): Promise<WorkflowInstance[]>;

    public executeOneTask(workflowId: string, taskPath: string, callerSocket ?: any, argument ?: any)

    public destroyWorkflow(workflowId: string);

    public destroyWorkflowsByRealm(realm : string) : Promise<any>;
}


/******************************************************************************
 *      Workflow & Tasks
 ******************************************************************************/

/**
 * An instance in the sequelize database.
 */
export interface WorkflowInstance {
    id: string;
    name: string;
}

type TaskStatus = 'inactive' | 'queued' | 'ok' | 'failed';
type WorkflowStatus = 'working' | 'done';

export namespace Tasks {
    export interface TreeTask extends Task {
        children: TreeTask[];
    }
}

export interface WorkflowErrorHandler 
{
    (workflowId : string, taskPath: string, err): void;
}

export interface DeleteWorkflowHandler
{
    (workflowId: string): void;
}

export namespace Workflows {
    export class TreeWorkflow {
        constructor(tasks: Tasks.TreeTask[]);
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
    [taskPath: string]: TaskHash;
}

export interface Task {
    name: string;
    description?: string;

    contextVar?: string; // If set, the task result will be added to the future contexts.

    condition?: { (context): boolean; };
    /**
     * If set, this callback is executed with the task result and task context.
     * The context does not contain the result, even if "contextVar" is set.
     */
    debug?: { (res, debug): void; };
    onComplete?: string;

    /**
     * Do not edit the context directly !
     * Use the udpateContext() function of the factory.
     */
    execute ? : {(arg, factory : Factory<any>) : Promise<any>;};
}

export interface Workflow {
    id: string;

    /**
     * Flatten all task paths of a workflow.
     */
    getAllPaths(): string[];

    /**
     * Get a description of the workflow tasks.
     */
    describe(): { tasks: WorkflowTreeTasks; };

    /**
     * Execute the whole workflow (until error)
     */
    execute(controller: ControllerInterface, argument ?: any): Promise<any>;

    getTask(path: string, baseContext, getTaskHash: { (workflowId: string, taskPath: string): Promise<TaskHash> });
}

export interface TaskError {
    type: string;
    payload: {
        body: any; // The error description

        argument: any;
        context: any;
    };
}

export interface WorkflowGenerator {
    (data: any): Workflow | Promise<Workflow>;
}

/**
 * Workflow state and configuration.
 */
export interface WorkflowHash {
    status: WorkflowStatus;

    realm: string;

    baseContext: any;
    ephemeral: boolean;

    generator: string;
    generatorData: any;
}

/**
 * The trace of a task execution, for a given workflow.
 */
export interface TaskHash {
    realm: string;

    // Result
    status: TaskStatus;
    body: any;
    executionTime: number;

    // Execution context
    argument: any;
    context: any;

    // During execution
    contextUpdaters?: any[];
}

