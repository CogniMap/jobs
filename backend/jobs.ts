const kue = require('kue');
const EventEmitter = require('events');

import {Controller} from './controller';
import {ExecutionErrorType, Status} from '../commons/types';
import {Redis} from './redis';
import {reduce} from '../commons/objects';

export namespace Priority {
  export const LOW = 'low';
  export const NORMAL = 'normal';
  export const MEDIUM = 'medium';
  export const HIGH = 'critical';
}

interface RunTaskJob {
  data: {
    workflowName: string;
    workflowId: string;
    taskPath: string;
    argument: any;
  }

  progress(frame, total, data);
}

interface RedisConfig {
  port: number;
  host: string;
}

class JobEvents extends EventEmitter {
}

/**
 * Manage kue jobs that execute the workflow tasks.
 *
 * There is only one job type : execute a SINGLE task of a workflow.
 */
export class Jobs {
  private queue = null;
  private controller: Controller;
  private redis : Redis = null;

  /**
   * We use a WebSocket server to dispatch in real time the jobs progression (and logs).
   */
  public constructor(config: RedisConfig, redis, controller: Controller) {
    this.controller = controller;
    this.queue = kue.createQueue({ // TODO use our redis client
      redis: config
    });
    this.redis = redis;

    // Setup kue
    this.queue.process('runTask', this.runTaskHandler.bind(this));
  }

  /**
   * Kue job handler. Call the controller run method (returns a Promise).
   * Upon promise resolve/reject, emit events and update the redis task hash.
   */
  private runTaskHandler(job: RunTaskJob, done)
  {
    let self = this;
    this.redis.getWorkflowField(job.data.workflowId, 'baseContext')
      .then(baseContext => {
        this.controller.run(job.data.workflowName, job.data.taskPath, job.data.workflowId, baseContext, job.data.argument)
        
          /**
           * Task success
           */
          .then((taskHash) => {
            // TODO
            job.progress(42, 100, {eventName: 'complete', eventBody: taskHash});
            done();
          })

          /**
           * Task error
           */
          .catch(err => {
            let {type, payload} = err;
            if (type == ExecutionErrorType.EXECUTION_FAILED) {
              // Error during the task execution
              self.redis.setTask(job.data.workflowId, job.data.taskPath, {
                status: 'failed',
                ... reduce(err, ['argument', 'context', 'body']),
              } as any).then(() => {
                job.progress(42, 100, {eventName: 'failed', eventBody: err});
                done();
              });
            } else {
              // Error before the task execution
              // TODO communication with caller
              job.progress(43, 100, err)
              done();
            }
          });
      });
  }

  /**
   * @return an event emitter of :
   *  - complete : callback(res);
   *  - failed : callback(err)
   *
   *  - job:progress
   *  - job:start
   */
  public runTask(workflowName, workflowId, taskPath, argument= null) {
    let jobEvents = new JobEvents();
    let job = this.queue.create('runTask', {
      workflowName,
      workflowId,
      taskPath,
      argument,

      events: jobEvents
    }).removeOnComplete(true);
    // TODO .ttl(Jobs.jobs[type]);

    job.save(function (err) {
      // TODO
      // Redirect events to all clients in the job room
      //const send = (chanel, data) => {
      //  Jobs.io.sockets.in(job.id).emit(chanel, Object.assign({}, data, {
      //  job: job.id,
      //  }));
      //};

      // TODO : rewrite kue to have real events passed to the handler
      // For now, we use special progress values :
      //    42, with the following data : {eventName, body}
      //    43, error before task execution
      job.on('progress', (progress, data) => {
        if (progress == 42) {
          jobEvents.emit(data.eventName, data.eventBody);
        } else if (progress == 43) {
          jobEvents.emit('error', data);
        }
      });
      job.on('start', () => {
        jobEvents.emit('job:start');
      });
    });
    return jobEvents;
  }
}
