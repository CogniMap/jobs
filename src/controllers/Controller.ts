import { TaskError, TaskHash, WorkflowStatus, ControllerConfiguration, ControllerInterface } from '../index.d';
import { Backend } from '../backends/Backend';
import { TaskWatcher } from '../backends/watcher';


/**
 * Base controller.
 */
export class Controller implements ControllerInterface
{
    protected backend : Backend;

    public constructor(backend : Backend, config : ControllerConfiguration)
    {
        this.backend = backend;
    }

    /**
     * Execute a single task, and create an events object to watch its progression.
     *
     * @param {string} workflowId
     * @param {string} taskPath
     * @return Promise Resolve when the task has been executed
     */
    public executeOneTask(workflowId : string, taskPath : string, argument = null) : Promise<TaskHash>
    {
        return new Promise((resolve, reject) => {
            this.backend.executeOneTask(workflowId, taskPath, argument)
                .then(watcher => {
                    watcher
                        .on('complete', resolve)
                        .on('failed', function (err : TaskError) {
                            reject(err.payload);
                        })
                        .on('error', reject);
                });
        });
    }

    /**
     * Execute all tasks of the given workflow.
     * It's the workflow which scheme the execution, in its execute() function.
     *
     * @param {string} workflowId
     * @param {any} argument
     * @returns {PromiseLike<never | T> | Promise<never | T>} Resolves with the latest result, when all thass of the workflow have been executed
     */
    public executeAllTasks(workflowId : string, argument = null) : Promise<any>
    {
        let self = this;
        return this.backend.getWorkflow(workflowId)
                   .then(res => {
                       let {workflow, workflowHash} = res;
                       return workflow.execute(self, argument);
                   });
    }

    /**
     * Called when all tasks of the workflow have been executed.
     * Usually it's called from the Workflow instance (that knows own tasks are chained).
     *
     * If the workflow is ephemeral, delete it
     *
     * @param {string} workflowId
     */
    public finishWorkflow(workflowId : string) : Promise<{}>
    {
        let self = this;
        return this.backend.getWorkflow(workflowId)
            .then(({workflow, workflowHash}) => {
                if (workflowHash.ephemeral) {
                    return this.backend.deleteWorkflow(workflowId);
                } else {
                    return this.backend.setWorkflowStatus(workflowId, 'done' as WorkflowStatus);
                }
            });
    }

    public onWorkflowUpdate(workflowId : string)
    {
    }
}