const socketio = require('socket.io');
const uniqid = require('uniqid');

import {Controller } from './controller';
import {Jobs} from './jobs';
import {WorkflowGenerator, WorkflowHash, TaskHash, Task, TaskError, Statuses, Status} from './index.d';
import {Redis} from './redis';
import {update} from './immutability';

const redisConfig = {
  host: "supervisionRedis",
  port: 6379,
};

let redis = new Redis(redisConfig);
let controller = new Controller(redis);
let jobs = new Jobs(redisConfig, redis, controller);
let io = null;

/**
 * This function create a new workflow instance, and returns its unique id.
 *
 * Clients can then watch its progression with the websocket interface.
 *
 * @param workflowData Is the data used by the workflow generator
 * @param execute If true, execute all tasks (until error) of the workflow.
 */
export function createWorkflowInstance(workflowGenerator: string, workflowData: any, baseContext = {}, execute : boolean = false) : Promise<string>
{
  let workflowId = uniqid();

  // Initialize the workflow instance in redis create tasks hashes
  let tasks = controller.generateWorkflow(workflowGenerator, workflowData);
  let paths = controller.getTasksPaths(tasks);

  return redis.initWorkflow(workflowGenerator, workflowData, paths, workflowId, baseContext)
    .then(() => {
      if (execute) {
        executeAllTasks(tasks, workflowId);
      }

      return workflowId;
    });
}

/**
 * Update the parameters of a workflow (the generator name, argument etc)
 * This update does not invalidate already executed steps of the workflow.
 *
 * Notify watchers of this workflow instance, if any
 *
 * @param workflowUpdater An updater of a WorkflowHash object
 */
export function updateWorkflow(workflowId : string, workflowUpdater) : Promise<{}>
{
  return redis.getWorkflow(workflowId)
    .then((workflow : WorkflowHash) => {
      let newWorkflow = update(workflow, workflowUpdater);

      return redis.saveWorkflow(workflowId, newWorkflow);
    })
}

/**
 * Execute all tasks of a workflow from @param startPath. If @param startPath == "#",
 * then all tasks are executed.
 */
export function executeAllTasks(tasks : Task[], workflowId : string, startPath : string = '#', callerSocket = null)
{
  executeOneTask(workflowId, startPath, callerSocket).then((jobEvents : any) => {
    jobEvents.on('complete', function (res) {
      let nextTaskPath = controller.getNextTask(tasks, startPath);
      executeOneTask(workflowId, nextTaskPath, callerSocket);
    });
  });
}

/**
 * Mark the task as queued, and then execute eit and register listeners to broadcast results
 * through the websockets.
 */
export function executeOneTask(workflowId : string, taskPath : string, callerSocket = null)
{
  return redis.setTaskStatus(workflowId, taskPath, 'queued').then(() => {
    return jobs.runTask(workflowId, taskPath)
      .on('complete', function (taskHash : TaskHash) {
        sendTasksStatuses(workflowId, {
          [taskPath]: {
            status: 'ok',
            ... (taskHash as any),
          }
        });
      })
      .on('failed', function (err : TaskError) {
        sendTasksStatuses(workflowId, {
          [taskPath]: {
            status: 'failed',
            ... err.payload
          }
        });
      })
      .on('error', function (err) {
        if (callerSocket != null) {
          callerSocket.emit('executionError', err);
        }
      });
    });
}

function sendTasksStatuses(workflowId : string, statuses : Statuses)
{
  io.sockets.in(workflowId).emit('setTasksStatuses', {
    id: workflowId,
    statuses
  });
}

/**
 * We use one socket.io room for each workflow instance. (The room name is the workflow id).
 * This way, several clients can watch one workflow progression.
 *
 * This function setup the websockets.
 *
 * Upon arrival, the client can send the following messages :
 *  - "watchWorkflowInstance" : To be notified of the worklow progress
 * When in a workflow instance room, the server send the following messages :
 *  - setTasksStatuses(taskPath : string, status : string, body ?: JSON string)
 *     Status is one of the following :
 *      - "queued" : The task will be executed soon
 *      - "error" : The previous execution of the task failed
 *      - "ok" : The previous execution of the task succeed
 *      - "inactive" The task has not been executed yet
 *     When the client start watching a workflow instance, the server send several statusMessages
 *     for all tasks of the workflow.
 *     Cf setTasksStatuses() for more details
 *  - workflowDescription(tasks) Send a WorkflowTasks to the client
 */
export function setupWebsockets(server)
{
  io = socketio.listen(server);

  io.on('connection', function (socket) {
    socket.emit('hello', {});

    // Get and send the status of all tasks of the given workflow
    function sendWorkflowStatus(workflowId : string, tasks : Task[]) {
      let paths = controller.getTasksPaths(tasks);
      let statuses = redis.getTasksStatuses(paths, workflowId)
        .then(statuses => {
          socket.emit('setTasksStatuses', {
            id: workflowId,
            statuses
          });
        });
    }

    // Watch a workflow instance events
    socket.on('watchWorkflowInstance', function (workflowId) {
      redis.getWorkflow(workflowId)
        .then((workflowHash : WorkflowHash) => {
          // Join the workflow room for progression udpates broadcast
          socket.join(workflowId);

          // Send the workflow description
          let tasks = controller.generateWorkflow(workflowHash.generator, workflowHash.generatorData);
          let descritption = controller.describeWorkflow(tasks).tasks;
          socket.emit('workflowDescription', {
            id: workflowId,
            tasks: descritption,
          });

          // Get initial status
          sendWorkflowStatus(workflowId, tasks);
        });
    });

    socket.on('executeTask', function (args) {
      let {workflowId, taskPath} = args;
      executeOneTask(workflowId, taskPath, socket);
    });
  });
}

/**
 * Proxy to the controller's function
 */
export function registerWorkflowGenerator(name : string, generator : WorkflowGenerator)
{
  return controller.registerWorkflowGenerator(name, generator);
}
