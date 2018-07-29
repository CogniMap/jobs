import {WorkflowInstance} from '../../index.d';

export abstract class IndexStorage {
    abstract getAll() : Promise<WorkflowInstance[]>;

    abstract create(workflow : {
        id: string;
        name: string;
    });
}