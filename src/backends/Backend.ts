import { TaskHash, WorkflowStatus, Statuses, WorkflowGenerator, Workflow, WorkflowHash } from '../index.d';
import { TaskWatcher } from './watcher';

/**
 * A controller provide a backend to store task hashes and workflow states.
 */
export abstract class Backend
{
    private generators : {
        [name : string] : WorkflowGenerator;
    } = {};

    /**
     * Create a workflow generator. This allows to create a custom tasks schema from any data.
     *
     * If a workflow with the given name already exists, override.
     */
    public registerWorkflowGenerator(name : string, generator : WorkflowGenerator)
    {
        this.generators[name] = generator;
    }

    /**
     * Call a generator to create the workflow tasks.
     */
    public generateWorkflow(generator : string, data : any, workflowId : string) : Promise<Workflow>
    {
        if (this.generators[generator] == null) {
            throw new Error('Unknow workflow generator : ' + generator);
        } else {
            let workflowPromise = this.generators[generator](data);
            if ((workflowPromise as Promise<Workflow>).then == null) {
                workflowPromise = Promise.resolve(workflowPromise);
            }
            return (workflowPromise as Promise<Workflow>).then(workflow => {
                workflow.id = workflowId;
                return workflow;
            });
        }
    }

    /**
     * Initialize the workflow tasks hashes.
     *
     * @param realm
     * @param workflowGenerator
     * @param workflowData
     * @param workflowId
     * @param options
     */
    public abstract initializeWorkflow(realm : string, workflowGenerator : string, workflowData : any, workflowId : string, options : {
        baseContext : any,
        ephemeral : any,
    }) : Promise<any>;

    /**
     * Update or create a sequelize entity.
     *
     * @param model
     * @param data
     * @returns {any}
     */
    public saveInstance(model, data)
    {
        if (data.id == null) {
            // Create a new instance.
            return model.create(data);
        } else {
            if (data.save != null) {
                // Data is already an instance
                return data.save();
            } else {
                return model.findById(data.id)
                            .then(instance => {
                                return instance.update(data);
                            });
            }
        }
    };

    /**
     * Factory methods common to all backends.
     */
    protected baseFactory()
    {
        return {
            saveInstance: this.saveInstance,
        };
    }


    public abstract executeOneTask(workflowId : string, taskPath : string, argument ? : any) : Promise<{
        watcher: TaskWatcher,
        taskHash: TaskHash
    }>;

    public abstract getWorkflowBaseContext(workflowId : string) : Promise<any>;

    /**
     * Get a workflow instance from a workflow id. It includes :
     *  - The workflow instance (tasks etc)
     *  - The workflow hash (config, state etc)
     *
     * @param workflowId
     * @param {() => any} interCallback If given, this callback is called before generating the workflow.
     * @returns {Promise<any>}
     */
    public abstract getWorkflow(workflowId, interCallback ?: any) : Promise<{
        workflow : Workflow,
        workflowHash : WorkflowHash
    }>;

    /**
     * Update the parameters of a workflow (the generator name, argument etc)
     * This update does not invalidate already executed steps of the workflow.
     *
     * @param workflowId
     * @param workflowUpdater An updater of a WorkflowHash object
     */
    public abstract updateWorkflow(workflowId : string, workflowUpdater) : Promise<{}>;

    public abstract setWorkflowStatus(workflowId : string, status : WorkflowStatus) : Promise<{}>;

    public abstract getTasksStatuses(paths : string[], workflowId : string) : Promise<Statuses>

    public abstract getAllWorkflowsUids() : Promise<string[]>;

    /**
     * Delete all data related to the given workflow.
     *
     * @param {string} workflowId
     */
    public abstract deleteWorkflow(workflowId : string) : Promise<{}>;

    public abstract deleteWorkflowsByRealm(realm : string) : Promise<{}>;
}