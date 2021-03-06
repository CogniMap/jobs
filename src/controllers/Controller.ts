import {
    TaskError, TaskHash,
    WorkflowStatus, WorkflowErrorHandler, WorkflowSuccessHandler,
    ControllerConfiguration, ControllerInterface
} from '../index.d';
import {Backend} from '../backends/Backend';


/**
 * Base controller.
 */
export class Controller implements ControllerInterface {
    protected backend: Backend;
    protected onError: WorkflowErrorHandler;
    protected onComplete: WorkflowSuccessHandler;

    public constructor(backend: Backend, config: ControllerConfiguration) {
        this.backend = backend;
        this.onError = config.onError;
        this.onComplete = config.onComplete;
    }

    /**
     * Execute a single task, and create an events object to watch its progression.
     *
     * @param {string} workflowId
     * @param {string} taskPath
     * @return Promise Resolve/Reject when the task has been executed
     */
    public executeOneTask(workflowId: string, taskPath: string, argument = null): Promise<TaskHash> {
        let self = this;
        return new Promise((resolve, reject) => {
            this.backend.executeOneTask(workflowId, taskPath, argument)
                .then((res) => {
                    if (res == null) {
                    } else {
                        let {watcher, taskHash} = res;
                        watcher
                            .on('complete', resolve)
                            .on('failed', function (err: TaskError) {
                                self.onWorkflowError(workflowId, taskPath, err.payload);
                                reject(err.payload);
                            })
                            .on('error', (err) => {
                                self.onWorkflowError(workflowId, taskPath, err);
                                reject(err);
                            });
                    }
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
    public executeAllTasks(workflowId: string, argument = null): Promise<any> {
        let self = this;
        return this.backend.getWorkflow(workflowId)
            .then(res => {
                let {workflow, workflowHash} = res;
                return workflow.execute(self, argument)
                    .catch((error) => {
                        let err = {}, taskPath = '#';
                        if (error != null) {
                            err = error.err;
                            taskPath = error.taskPath
                        }
                        self.onWorkflowError(workflowId, taskPath, err);
                        return Promise.reject(err);
                    })
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
    public finishWorkflow(workflowId: string): Promise<{}> {
        let self = this;
        return this.backend.getWorkflow(workflowId)
            .then(({workflow, workflowHash}) => {
                if (self.onComplete) {
                    self.onComplete(workflowId);
                }
                if (workflowHash.ephemeral) {
                    return self.backend.deleteWorkflow(workflowId);
                } else {
                    return self.backend.setWorkflowStatus(workflowId, 'done' as WorkflowStatus);
                }
            });
    }

    /**
     * Call the onError callback, and delete the workflow if it is ephemeral.
     *
     * @param {string} workflowId
     * @param err
     */
    protected onWorkflowError(workflowId: string, taskPath: string, err) {
        if (this.onError != null && taskPath != null) {
            this.onError(workflowId, taskPath, err);
        }

        let self = this;
        return this.backend.getWorkflow(workflowId)
            .then(({workflow, workflowHash}) => {
                if (workflowHash.ephemeral) {
                    return self.backend.deleteWorkflow(workflowId);
                }
            });
    }

    public onWorkflowUpdate(workflowId: string) {
    }
}