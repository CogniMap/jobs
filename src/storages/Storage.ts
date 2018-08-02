import {
    WorkflowHash, TaskHash,
    Statuses, TaskStatus, WorkflowStatus,
} from '../index.d';
import {update} from '../immutability';

/**
 * Store key pairs objects.
 *
 * An object is indexed by strings. Its values can be strings, numbers, or objects.
 */
export abstract class Storage {

    // Backend implementation

    abstract set(key: string, data);

    abstract setField(key: string, field: string, data);

    abstract bulkSet(values: {
        key: string,
        data: any
    }[]);

    abstract get(key: string);

    abstract getField(key: string, field: string);

    abstract bulkGet(keys: string[]);

    abstract delete(key: string);

    abstract bulkDelete(keys: string[]);

    abstract deleteByField(field : string, data);

    abstract getAllWorkflowsUids() : Promise<string[]>;

    // Application logic

    /********************************************************
     * Workflows
     *******************************************************/

    public initWorkflow(realm : string, workflowGenerator: string, generatorData: any, paths: string[], workflowId: string,
                        baseContext, ephemeral: boolean) {
        let values = [
            {
                key: 'workflow_' + workflowId,
                data: {
                    realm,
                    status: 'working' as WorkflowStatus,

                    generator: workflowGenerator,
                    generatorData,

                    baseContext,
                    ephemeral,
                } as WorkflowHash as any
            }
        ];
        for (let path of paths) {
            values.push({
                key: 'workflowTask_' + workflowId + '_' + path,
                data: {
                    realm,
                    status: 'inactive',
                    body: null,
                    argument: null,
                    context: null,
                    contextUpdaters: [],
                    executionTime: null,
                } as TaskHash as any
            });
        }
        return this.bulkSet(values);
    }

    public getWorkflow(workflowId: string): Promise<WorkflowHash> {
        return this.get('workflow_' + workflowId);
    }

    public saveWorkflow(workflowId: string, workflow: WorkflowHash): Promise<{}> {
        return this.set('workflow_' + workflowId, workflow);
    }

    public getWorkflowField(workflowId: string, field: string): Promise<any> {
        return this.getField('workflow_' + workflowId, field)
            .then(value => {
                if (value == null) {
                    throw new Error('Unknow workflow : "' + workflowId + '"');
                }
                return value;
            });
    }

    public getWorkflowName(workflowId: string): Promise<string> {
        return this.getWorkflowField(workflowId, 'workflowName');
    }

    public setWorkflowStatus(workflowId, status: WorkflowStatus) {
        return this.setField('workflow_' + workflowId, 'status', status);
    }

    public deleteWorkflow(workflowId: string): Promise<{}> {
        return this.delete('workflow_' + workflowId);
    }

    /********************************************************
     * Tasks
     *******************************************************/

    public setTaskStatus(workflowId: string, taskPath: string, status: TaskStatus) {
        return this.setField(this.getTaskHash(workflowId, taskPath), 'status', status);
    }

    private getTaskHash(workflowId: string, taskPath: string) {
        return 'workflowTask_' + workflowId + '_' + taskPath;
    }

    public getTask(workflowId: string, taskPath: string): Promise<TaskHash> {
        let self = this;
        return this.get(this.getTaskHash(workflowId, taskPath));
    }

    public setTask(workflowId: string, taskPath: string, task: TaskHash): Promise<TaskHash> {
        return this.set(this.getTaskHash(workflowId, taskPath), task)
            .then(() => task);
    }

    public updateTask(workflowId: string, taskPath: string, updater): Promise<TaskHash> {
        let self = this;
        return this.getTask(workflowId, taskPath)
            .then(taskHash => {
                let newTaskHash = update(taskHash, updater);
                return self.setTask(workflowId, taskPath, newTaskHash);
            });
    }

    /**
     * Get the status of all tasks of the given workflow (in a flat array).
     */
    public getTasksStatuses(paths: string[], workflowId: string): Promise<Statuses> {
        let self = this;
        let keys = paths.map(path => {
            return self.getTaskHash(workflowId, path);
        });
        return this.bulkGet(keys).then(replies => {
            let statuses = {};
            paths.map((path, i) => {
                statuses[path] = replies[i];
            });
            return statuses;
        });
    }

    public deleteTasks(workflowId: string, paths: string[]): Promise<{}> {
        let self = this;
        return this.bulkDelete(paths.map(path => {
            return self.getTaskHash(workflowId, path);
        }));
    }
}