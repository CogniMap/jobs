const kue = require('kue');

import {
    RedisConfig, BackendInterface,
} from './index.d';
import { ExecutionErrorType } from './common';
import { Storage} from './storages/Storage';
import { reduce } from './objects';
import { TaskWatcher } from './backends/watcher';
import { AsyncBackend } from './backends/AsyncBackend';

export namespace Priority
{
    export const LOW = 'low';
    export const NORMAL = 'normal';
    export const MEDIUM = 'medium';
    export const HIGH = 'critical';
}

interface RunTaskJob
{
    data : {
        workflowId : string;
        taskPath : string;
        argument : any;
    }

    progress(frame, total, data);
}


/**
 * Manage kue jobs that execute the workflow tasks.
 *
 * There is only one job type : execute a SINGLE task of a workflow.
 */
export class Queue
{
    private queue = null;
    private backend : AsyncBackend;
    private storage : Storage = null;

    /**
     * We use a WebSocket server to dispatch in real time the jobs progression (and logs).
     */
    public constructor(config : {host: string, port ?: number}, storage, backend : AsyncBackend)
    {
        this.queue = kue.createQueue({ // TODO use our redis client
            redis: config,
        });
        this.storage = storage;
        this.backend = backend;

        // Setup kue
        this.queue.process('scheduleTask', this.runTaskHandler.bind(this));
    }

    /**
     * Kue job handler. Call the controller run method (returns a Promise).
     * Upon promise resolve/reject, emit events and update the redis task hash.
     */
    private runTaskHandler(job : RunTaskJob, done)
    {
        let self = this;
        if (this.backend == null) {
            throw new Error('No registered controller');
        }

        this.backend.getWorkflowBaseContext(job.data.workflowId)
            .then(baseContext => {
                self.backend.run(job.data.workflowId, job.data.taskPath, baseContext, job.data.argument)

                /**
                 * Task success
                 */
                    .then((taskHash) => {
                        // TODO
                        job.progress(42, 100, {status: 'complete', eventBody: taskHash});
                        done();
                    })

                    /**
                     * Task error
                     */
                    .catch(err => {
                        let {type, payload} = err;
                        if (type == ExecutionErrorType.EXECUTION_FAILED) {
                            // Error during the task execution
                            self.storage.setTask(job.data.workflowId, job.data.taskPath, {
                                status: 'failed',
                                ... reduce(err, ['argument', 'context', 'body']),
                            } as any)
                                .then(() => {
                                    job.progress(42, 100, {status: 'failed', eventBody: err});
                                    done();
                                });
                        } else {
                            // Error before the task execution
                            // TODO communication with caller
                            job.progress(43, 100, err);
                            done();
                        }
                    });
            });
    }

    /**
     * Schedule the given task in the queue.
     */
    public scheduleTask(workflowId, taskPath, argument = null) : TaskWatcher
    {
        let watcher = new TaskWatcher();
        let job = this.queue.create('scheduleTask', {
            workflowId,
            taskPath,
            argument,

            events: watcher,
        })
                      .removeOnComplete(true);
        // TODO .ttl(Queue.jobs[type]);

        job.save(function (err) {
            // TODO : rewrite kue to have real events passed to the handler
            // For now, we use special progress values :
            //    42, with the following data : {status, body}.
            //    43, error before task execution
            job.on('progress', (progress, data) => {
                if (progress == 42) {
                    if (data.status == 'complete') {
                        watcher.complete(data.eventBody);
                    } else {
                        watcher.failed(data.eventBody);
                    }
                } else if (progress == 43) {
                    watcher.error(data);
                }
            });
            job.on('start', () => watcher.start());
        });
        return watcher;
    }
}
