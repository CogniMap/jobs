const socketio = require('socket.io');
const uniqid = require('uniqid');

import {Controller, Task} from './controller';
import {Jobs} from './jobs';
import {TaskError, Statuses, Status} from '../commons/types';
import {Redis, TaskHash} from './redis';

console.log('INIT JOBS');
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
 * @param execute If true, execute all tasks (until error) of the workflow.
 */
export function createWorkflowInstance(workflowName : string, baseContext = {}, execute : boolean = false) : Promise<string>
{
  let workflowId = uniqid();

  // Initialize the workflow instance in redis create tasks hashes
  let paths = controller.getTasksPaths(workflowName);

  return redis.initWorkflow(workflowName, paths, workflowId, baseContext)
    .then(() => {
      if (execute) {
        executeAllTasks(workflowName, workflowId);
      }

      return workflowId;
    });
}

/**
 * Execute all tasks of a workflow from @param startPath. If @param startPath == "#",
 * then all tasks are executed.
 */
function executeAllTasks(workflowName : string, workflowId : string, startPath : string = '#', callerSocket = null)
{
  executeOneTask(workflowId, startPath, callerSocket).then((jobEvents : any) => {
    jobEvents.on('complete', function (res) {
      let nextTaskPath = controller.getNextTask(workflowName, startPath);
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
  return redis.getWorkflowName(workflowId)
    .then(workflowName => {
      redis.setTaskStatus(workflowId, taskPath, 'queued').then(() => {
      return jobs.runTask(workflowName, workflowId, taskPath)
        .on('complete', function (taskHash : TaskHash) {
          sendTasksStatuses(workflowId, {
            [taskPath]: {
              status: 'ok',
              ... taskHash,
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
export function setupWebsockets(server) {
  io = socketio.listen(server);

  io.on('connection', function (socket) {
    socket.emit('hello', {});

    // Get and send the status of all tasks of the given workflow
    function sendWorkflowStatus(workflowName : string, workflowId : string) {
      let paths = controller.getTasksPaths(workflowName);
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
      redis.getWorkflowName(workflowId)
        .then(workflowName => {
          // Join the workflow room for progression udpates broadcast
          socket.join(workflowId);

          // Send the workflow description
          let tasks = controller.describeWorkflow(workflowName).tasks;
          socket.emit('workflowDescription', {
            id: workflowId,
            tasks
          });

          // Get initial status
          sendWorkflowStatus(workflowName, workflowId);
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
export function registerWorkflow(name, tasks : Task[])
{
  return controller.registerWorkflow(name, tasks);
}
