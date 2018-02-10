import {
    ControllerInterface,
    WorkflowTreeTasks, Workflow,
    Task, TaskHash,
} from '../index.d';

export abstract class BaseWorkflow implements Workflow
{
    public id : string;
    protected onError : {(err) : void};

    protected constructor(onError : {(err) : void})
    {
        if (onError == null) {
            this.onError = (err) => null;
        } else {
            this.onError = onError;
        }
    }

    public abstract getTask(path : string, baseContext,
                            getTaskHash : {(workflowId : string, taskPath : string) : Promise<TaskHash>}) : Promise<{
        context : {[varName : string] : any;};
        resultContext : {[varName : string] : any;};
        task : Task;
        prevResult : any,
    }>;

    /**
     * Get a list of all tasks paths.
     *
     * @returns {string[]}
     */
    public abstract getAllPaths() : string[];

    /**
     * Get a tree description of the workflow's tasks.
     *
     * @returns {{tasks: WorkflowTreeTasks}}
     */
    public abstract describe() : {tasks : WorkflowTreeTasks;};

    /**
     * Execute all tasks of the workflow
     *
     * @param {BackendInterface} controller
     * @param argument
     */
    public abstract execute(controller : ControllerInterface, argument ? : any) : Promise<any>;
}
