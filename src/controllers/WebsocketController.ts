const socketio = require('socket.io');
const Promise = require('bluebird');

import {TaskWatcher} from '../backends/watcher';
import {Backend} from '../backends/Backend';
import {Packets} from '../network';
import {Controller} from './Controller';
import {
    TaskHash, Statuses, TaskError,
    Workflow, WorkflowHash, WorkflowStatus,
    WebsocketControllerConfig, ControllerConfiguration
} from '../index.d';

/**
 * WARNING : You can't launch two Jobs instance with a websocket controller (the lastly
 * declared websocket contorller will handle all connections).
 */
export class WebsocketController extends Controller {
    private io;

    public constructor(backend: Backend, config: WebsocketControllerConfig) {
        super(backend, config as ControllerConfiguration);

        this.setupWebsockets(config.server);
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
     *
     *  @param app An express-like app
     */
    public setupWebsockets(server) {
        let self = this;
        this.io = socketio(server, {
            serveClient: false,
            pingInterval: 10000,
            pingTimeout: 5000,
            cookie: false
        });

        this.io.on('connection', function (socket) {
                Packets.hello(socket);

                // Get and send the status of all tasks of the given workflow
                function sendWorkflowStatus(workflowHash: WorkflowHash, workflow: Workflow) {
                    Packets.setWorkflowStatus(socket, workflow.id, workflowHash.status);
                    sendTasksStatuses(socket, workflow.id);
                }

                function sendTasksStatuses(socket, workflowId) {
                    self.backend.getWorkflow(workflowId)
                        .then(res => {
                            let {workflow, workflowHash} = res;
                            let paths = workflow.getAllPaths();
                            return self.backend.getTasksStatuses(paths, workflowId)
                                .then(statuses => {
                                    Packets.setTasksStatuses(socket, workflow.id, statuses);
                                })
                        })
                        .catch(console.error);
                }

                // Watch a workflow instance events
                socket.on('watchWorkflowInstance', function (workflowId) {
                    Packets.catchError(socket,
                        self.backend.getWorkflow(workflowId, () => {
                            socket.join(workflowId);
                        })
                            .then(res => {
                                let {workflow, workflowHash} = res;

                                let description = workflow.describe();
                                Packets.workflowDescription(socket, workflowId, description.tasks);

                                // Get initial status
                                sendWorkflowStatus(workflowHash, workflow);
                            }),
                    );
                });

                socket.on('executeTask', function (args) {
                    let {workflowId, taskPath, arg} = args;
                    Packets.catchError(socket, self.executeOneTask(workflowId, taskPath));
                });

                socket.on('executeAllTasks', function (args) {
                    let {workflowId, taskPath, initialArg} = args;
                    Packets.catchError(socket,
                        self.executeAllTasks(workflowId, initialArg),
                    );
                });
            },
        );
    }

    /**
     * @param {string} workflowId
     * @param {string} taskPath
     * @returns {Promise<TaskWatcher>} Resolves when the task has been executed.
     */
    public executeOneTask(workflowId: string, taskPath: string): Promise<TaskHash> {
        let self = this;
        return new Promise((resolve, reject) => {
            this.backend.executeOneTask(workflowId, taskPath)
                .then(({watcher, taskHash}) => {
                    if (taskHash != null) {
                        self.sendTasksStatuses(workflowId, {
                            [taskPath]: {
                                status: 'queue',
                                ... (taskHash as any),
                            },
                        });
                    }

                    watcher
                        .on('complete', function (taskHash: TaskHash) {
                            self.sendTasksStatuses(workflowId, {
                                [taskPath]: {
                                    status: 'ok',
                                    ... (taskHash as any),
                                },
                            });
                            resolve(taskHash);
                        })
                        .on('failed', function (err: TaskError) {
                            self.sendTasksStatuses(workflowId, {
                                [taskPath]: {
                                    status: 'failed',
                                    ...err.payload
                                } as any,
                            });
                            self.onWorkflowError(workflowId, taskPath, err.payload);
                            reject(err.payload);
                        })
                        .on('error', function (err) {
                            self.onWorkflowError(workflowId, taskPath, err);
                            Packets.Errors.executionError(self.io.sockets.in(workflowId), err);
                            reject(err);
                        });
                    return watcher;
                });
        });
    }

    /**
     * If a websocket server is registered, dispatch statuses update.
     */
    private sendTasksStatuses(workflowId: string, statuses: Statuses) {
        if (this.io != null) {
            Packets.setTasksStatuses(this.io.sockets.in(workflowId), workflowId, statuses);
        }
    }

    /**
     * @inheritDoc
     */
    public finishWorkflow(workflowId: string): Promise<{}> {
        return (super.finishWorkflow(workflowId) as any)
            .then(() => {
                if (this.io != null) {
                    Packets.setWorkflowStatus(this.io.sockets.in(workflowId), workflowId, 'done');
                }
            });
    }
}
