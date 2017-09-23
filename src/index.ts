import { Packets } from './network';

const socketio = require('socket.io');
const uniqid = require('uniqid');

import { Controller } from './controller';
import { Jobs as AsyncJobs } from './jobs';
import {
    WorkflowGenerator, WorkflowHash, Workflow, WorkflowStatus,
    TaskHash, Task, TaskError,
    Statuses, TaskStatus,
} from './index.d';
import { Redis } from './redis';
import { update } from './immutability';
import { stat } from 'fs';

export const Workflows = require('./workflows');

export class Jobs
{
    private redisConfig : {
        host : string,
        port : number,
    };
    private redis;
    private jobs : AsyncJobs;
    private controller : Controller;
    private io;


    public constructor(redisConfig)
    {
        redisConfig = Object.assign({}, {
            port: 6379,
        }, redisConfig);
        this.redis = new Redis(redisConfig);
        this.jobs = new AsyncJobs(redisConfig, this.redis);
        this.controller = new Controller(this.redis, this.jobs);
        this.io = null;
    }

    /**
     * This function create a new workflow instance, and returns its unique id.
     *
     * Clients can then watch its progression with the websocket interface.
     *
     * @param workflowData Is the data used by the workflow generator
     * @param execute If true, execute all tasks (until error) of the workflow.
     */
    public createWorkflowInstance(workflowGenerator : string, workflowData : any, baseContext = {},
                                  execute : boolean = false) : Promise<string>
    {
        let workflowId = uniqid();

        // Initialize the workflow instance in redis create tasks hashes
        let workflowPromise = this.controller.generateWorkflow(workflowGenerator, workflowData, workflowId);

        return workflowPromise.then(workflow => {
            let paths = workflow.getAllPaths();

            return this.redis.initWorkflow(workflowGenerator, workflowData, paths, workflowId, baseContext)
                       .then(() => {
                           if (execute) {
                               workflow.execute(this.controller, null);
                           }

                           return workflowId;
                       });
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
    public updateWorkflow(workflowId : string, workflowUpdater) : Promise<{}>
    {
        return this.redis.getWorkflow(workflowId)
                   .then((workflow : WorkflowHash) => {
                       let newWorkflow = update(workflow, workflowUpdater);

                       return this.redis.saveWorkflow(workflowId, newWorkflow);
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
    public setupWebsockets(server)
    {
        let self = this;
        this.io = socketio.listen(server);
        this.controller.registerSockets(this.io);

        this.io.on('connection', function (socket) {
            Packets.hello(socket);

            // Get and send the status of all tasks of the given workflow
            function sendWorkflowStatus(workflowHash : WorkflowHash, workflow : Workflow)
            {
                Packets.setWorkflowStatus(socket, workflow.id, workflowHash.status);

                let paths = workflow.getAllPaths();
                let statuses = self.redis.getTasksStatuses(paths, workflow.id)
                                   .then(statuses => {
                                       Packets.setTasksStatuses(socket, workflow.id, statuses);
                                   });
            }

            // Watch a workflow instance events
            socket.on('watchWorkflowInstance', function (workflowId) {
                self.redis.getWorkflow(workflowId)
                    .then((workflowHash : WorkflowHash) => {
                        // Join the workflow room for progression udpates broadcast
                        socket.join(workflowId);

                        // Send the workflow description
                        self.controller.generateWorkflow(workflowHash.generator, workflowHash.generatorData, workflowId)
                            .then(workflow => {

                                let description = workflow.describe();
                                Packets.workflowDescription(socket, workflowId, description.tasks);

                                // Get initial status
                                sendWorkflowStatus(workflowHash, workflow);
                            });
                    });
            });

            socket.on('executeTask', function (args) {
                let {workflowId, taskPath} = args;
                self.controller.executeOneTask(workflowId, taskPath, socket);
            });
        });
    }

    /**
     * Proxy to the controller's function
     */
    public registerWorkflowGenerator(name : string, generator : WorkflowGenerator)
    {
        return this.controller.registerWorkflowGenerator(name, generator);
    }
}
