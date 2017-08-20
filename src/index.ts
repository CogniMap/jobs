const socketio = require('socket.io');
const uniqid = require('uniqid');

import {Controller } from './controller';
import {Jobs} from './jobs';
import {
  WorkflowGenerator, WorkflowHash, Workflow, WorkflowStatus,
  TaskHash, Task, TaskError,
  Statuses, TaskStatus
} from './index.d';
import {Redis} from './redis';
import {update} from './immutability';

export const Workflows = require('./workflows');

const redisConfig = {
  host: "supervisionRedis",
  port: 6379,
};

let redis = new Redis(redisConfig);
let jobs = new Jobs(redisConfig, redis);
let controller = new Controller(redis, jobs);
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
  let workflow = controller.generateWorkflow(workflowGenerator, workflowData, workflowId);
  let paths = workflow.getAllPaths();

  return redis.initWorkflow(workflowGenerator, workflowData, paths, workflowId, baseContext)
    .then(() => {
      if (execute) {
        workflow.execute(controller, null);
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
 * We use one socket.io room for each workflow instance. (The room name is the workflow id).
 * This way, several clients can watch one workflow progression.
 *
 * This function setup the websockets.
 *
 * Upon arrival, the client can send the following messages :
 *  - "watchWorkflowInstance" : To be notified of the worklow progress
 * When in a workflow instance room, the server send the following messages :
 *  - setWorkflowStatus(status : string)
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
  controller.registerSockets(io);

  io.on('connection', function (socket) {
    socket.emit('hello', {});

    // Get and send the status of all tasks of the given workflow
    function sendWorkflowStatus(workflowHash : WorkflowHash, workflow : Workflow) {
      socket.emit('setWorkflowStatus', workflowHash.status);

      let paths = workflow.getAllPaths();
      let statuses = redis.getTasksStatuses(paths, workflow.id)
        .then(statuses => {
          socket.emit('setTasksStatuses', {
            id: workflow.id,
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
          let workflow = controller.generateWorkflow(workflowHash.generator, workflowHash.generatorData, workflowId);
          let descritption = workflow.describe();
          socket.emit('workflowDescription', {
            id: workflowId,
            tasks: descritption.tasks,
          });

          // Get initial status
          sendWorkflowStatus(workflowHash, workflow);
        });
    });

    socket.on('executeTask', function (args) {
      let {workflowId, taskPath} = args;
      controller.executeOneTask(workflowId, taskPath, socket);
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
