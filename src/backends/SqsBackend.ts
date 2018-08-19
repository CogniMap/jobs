const AWS = require('aws-sdk');
const values = require('object.values');
const Promise = require('bluebird');
const Consumer = require('sqs-consumer');
const uuidv4 = require('uuid/v4');
const objectPath = require('object-path');

import {TaskWatcher} from "./watcher";
import {getTasksStorageInstance} from "../storages/factory";
import {
    Sqs,
    Workflow, WorkflowHash,
    Statuses, TaskHash, TaskStatus, WorkflowStatus,
    BackendInterface, SqsBackendConfiguration,
} from '../index.d';
import {update} from '../immutability';
import {Backend} from './Backend';
import {Storage} from '../storages/Storage';
import {debug, debug2} from "../logging";

interface SqsMessage {
    MessageId: string;
    Body: string;
}

/**
 * Use AWS SQS to manage tasks execution.
 *
 * The backend does not execute the tasks, it just put messages on sqs queues for workers
 * to execute them. The SQS Backend listen for information message to dispatch them to the controller.
 *
 * Warning : The backend is not persistent after a server reboot !
 *
 * There are two kinds of queues :
 *  - Supervision, for supervision messages (runTask etc)
 *  - Worker, for worker messages (result, etc)
 */
export class SqsBackend extends Backend implements BackendInterface {
    private storage: Storage;
    private deleteHandler;

    private sqs;

    private supervisionUid: string;
    private workers: {
        [workerName: string]: {
            uid?: string;
            queues?: {
                workerMessagesUrl: string;
                supervisionMessagesUrl: string;
            };
        };
    };

    private tasks: {
        [workflowId: string]: {
            [taskPath: string]: {
                watcher: TaskWatcher,
                contextUpdaters: any[],
                argument: any,
                callingContext: any
            };
        }
    };

    public constructor(config: SqsBackendConfiguration) {
        super();

        this.storage = getTasksStorageInstance(config.tasksStorage);
        this.deleteHandler = config.onDeleteWorkflow;

        this.tasks = {};
        this.workers = {};

        this.sqs = new AWS.SQS({
            apiVersion: '2012-11-05',
            region: config.region,
            ... (config.awsCredentials || {})
        });
        this.supervisionUid = uuidv4();

        // Setup the sqs listeners
        this.setupQueues(config.workers, config.queueNamesPrefix);
    }

    /**
     * Resolve the the queue url
     *
     * @param {string} queueName
     * @returns {Promise<string>}
     */
    private createQueuesIfNotExist(queueNamePrefix: string): Promise<{
        workerMessagesUrl: string;
        supervisionMessagesUrl: string;
    }> {
        let self = this;

        function createQueue(queueName) {
            return self.sqs.listQueues({
                QueueNamePrefix: queueName
            }).promise().then(data => {
                if (data.QueueUrls && data.QueueUrls.length > 0) {
                    return data.QueueUrls[0];
                } else {
                    debug('[Jobs INFO] Creating SQS FIFO queue ' + queueName);
                    return self.sqs.createQueue({
                        QueueName: queueName + '.fifo',
                        Attributes: {
                            FifoQueue: 'true'
                        }
                    }).promise().then(data => {
                        return data.QueueUrl;
                    })
                }
            });
        }

        return Promise.all([
            createQueue(queueNamePrefix + '_workerMessages'),
            createQueue(queueNamePrefix + '_supervisionMessages'),
        ]).then(res => {
            return {
                workerMessagesUrl: res[0],
                supervisionMessagesUrl: res[1],
            };
        })
    }

    private sendSupervisionHelloMessage(): Promise<any> {
        return this.sendMessage({
            type: 'supervisionHello',
            supervisionUid: this.supervisionUid,
        } as Sqs.SupervisionHelloMessage);
    }

    /**
     * We don't purge queues because it can take up to 60 seconds.
     *
     * Instead, we use SupervisionUid and WorkerUids. They are sent with HelloPackets
     *
     * @param {Sqs.Worker[]} workers
     * @param {string} queueNamesPrefix
     * @returns {any}
     */
    private setupQueues(workers: Sqs.Worker[], queueNamesPrefix: string) {
        let self = this;
        return Promise.all(workers.map(worker => {
            let queueName = queueNamesPrefix + '_' + worker.name;
            return self.createQueuesIfNotExist(queueName).then(queueUrls => {
                self.workers[worker.name] = {
                    queues: queueUrls
                };
                return self.sendSupervisionHelloMessage().then(() => {
                    let handler = Consumer.create({
                        queueUrl: queueUrls.workerMessagesUrl,
                        handleMessage: (message, done) => {
                            let body = JSON.parse(message.Body);
                            self.handleMessage(worker.name, body);
                            done();
                        },
                        sqs: self.sqs
                    });
                    handler.on('error', (err => {
                        console.error(err);
                    }));
                    handler.start();
                });
            });
        }));
    }

    private handleMessage(workerName: string, workerMessage: Sqs.WorkerMessage) {
        debug2('[Jobs DEBUG] Receive worker message : ', workerMessage);
        let self = this;

        if (workerMessage.type == "workerHello") {
            let helloMessage = workerMessage as Sqs.WorkerHelloMessage;
            this.workers[workerName].uid = helloMessage.workerUid;
            return;
        } else {
            // Only process messages from known workers (ie they might be remaining messages in the queue)
            let knownWorkerUid = this.workers[workerName].uid;
            if (knownWorkerUid == null || workerMessage.workerUid != knownWorkerUid) {
                return;
            }
        }

        let workflowWorkerMessage = workerMessage as Sqs.WorkflowWorkerMessage;
        let {workflowId, taskPath} = workflowWorkerMessage;
        let taskDetails = self.tasks[workflowId] && self.tasks[workflowId][workflowWorkerMessage.taskPath];
        if (taskDetails == null) {
            debug('[Jobs DEBUG] Unknow workflow task watcher (' + workflowId + ' - ' + taskPath + '). Skipping');
            debug(self.tasks);
            return;
        }

        switch (workerMessage.type) {
            case "result": {
                let resultMessage = workerMessage as Sqs.ResultMessage;

                let taskResult = resultMessage.result;

                return self.getTaskHash(workflowId, taskPath).then(taskHash => {
                    // Update the task hash
                    let currentDate = new Date();
                    let newTaskHash = {
                        realm: taskHash.realm,
                        status: 'ok' as TaskStatus,
                        argument: taskDetails.argument,
                        context: taskDetails.callingContext,
                        body: taskResult || null,
                        contextUpdaters: taskDetails.contextUpdaters,
                        executionTime: currentDate.getTime(),
                    };

                    return self.storage.setTask(workflowId, taskPath, newTaskHash).then(() => {
                        debug2('[Jobs DEBUG] New task hash : ', newTaskHash);
                        taskDetails.watcher.complete(newTaskHash);
                    })
                });
            }
            case "fail": {
                let failMessage = workerMessage as Sqs.FailMessage;

                taskDetails.watcher.error(failMessage.error);
                break;
            }
            case "updateContext": {
                let updateContextMessage = workerMessage as Sqs.UpdateContextMessage;

                taskDetails.contextUpdaters.push(updateContextMessage.updater);
                break;
            }
            default:
                debug("[Jobs WARN] Unknow worker message type : " + workerMessage.type);
        }
    }

    /**
     * Send the given message to all workers
     *
     * @param body
     */
    private sendMessage(body: any) {
        let self = this;
        return Promise.all(values(this.workers).map(worker => {
            let queueUrls = worker.queues;
            return self.sqs.sendMessage({
                QueueUrl: queueUrls.supervisionMessagesUrl,
                MessageGroupId: 'supervision',
                MessageDeduplicationId: uuidv4(),
                MessageBody: JSON.stringify(body)
            }).promise();
        }));
    }

    private sendRunTaskMessage(workflowId: string, taskPath: string, argument, context) {
        return this.sendMessage({
            type: 'runTask',
            workflowId,
            taskPath,
            param: argument,
            context
        } as Sqs.RunTaskMessage);
    }

    public initializeWorkflow(realm: string, workflowGenerator: string, workflowData: any, workflowId: string, options) {
        return this.generateWorkflow(workflowGenerator, workflowData, workflowId)
            .then(workflow => {
                let paths = workflow.getAllPaths();
                return this.storage.initWorkflow(realm, workflowGenerator, workflowData, paths, workflowId,
                    options.baseContext, options.ephemeral);
            });
    }

    /**
     * Get results of a task for a given workflow.
     *
     * @param {string} workflowId
     * @param {string} taskPath
     */
    private getTaskHash(workflowId: string, taskPath: string): Promise<TaskHash> {
        return this.storage.getTask(workflowId, taskPath);
    }

    /**
     * Queue the task.
     * Register listeners to broadcast results through the websockets.
     *
     * @param workflowId
     * @param taskPath
     * @param argument
     */
    public executeOneTask(workflowId: string, taskPath: string, argument = null) {
        // First, get the workflow to make sure it still exists
        let self = this;
        return this.getWorkflow(workflowId).then(({workflowHash, workflow}) => {
            if (workflowHash == null || workflowHash.generator == null) {
                console.warn("[JOBS] Workflow does not exist : " + workflowId);
            } else {
                return self.storage.setTaskStatus(workflowId, taskPath, 'queued')
                    .then(() => {
                        return workflow.getTask(taskPath, workflowHash.baseContext, self.getTaskHash.bind(self))
                            .then(({task, context, prevResult, resultContext}) => {
                                return self.storage.getTask(workflowId, taskPath).then(taskHash => {
                                    let watcher = new TaskWatcher();

                                    if (self.tasks[workflowId] == null) {
                                        self.tasks[workflowId] = {};
                                    }
                                    self.tasks[workflowId][taskPath] = {
                                        watcher,
                                        contextUpdaters: [],
                                        callingContext: context,
                                        argument
                                    };

                                    self.sendRunTaskMessage(workflowId, taskPath, argument, context).then(() => {
                                        watcher.start();
                                    });
                                    return {taskHash, watcher};
                                });
                            })
                    });
            }
        })
    }

    public getWorkflowBaseContext(workflowId: string): Promise<any> {
        return this.storage.getWorkflowField(workflowId, 'baseContext');
    }

    /**
     * @inheritDoc
     */
    public getWorkflow(workflowId, interCallback = () => null): Promise<{
        workflow: Workflow,
        workflowHash: WorkflowHash
    }> {
        let self = this;
        return this.storage.getWorkflow(workflowId)
            .then((workflowHash: WorkflowHash) => {
                interCallback();
                return self.generateWorkflow(workflowHash.generator,
                    workflowHash.generatorData, workflowId)
                    .then(workflow => {
                        return {workflow, workflowHash};
                    });
            });
    }

    /**
     * @inheritDoc
     */
    public updateWorkflow(workflowId: string, workflowUpdater) {
        return this.storage.getWorkflow(workflowId)
            .then((workflow: WorkflowHash) => {
                let newWorkflow = update(workflow, workflowUpdater);

                return this.storage.saveWorkflow(workflowId, newWorkflow);
            });
    }

    public setWorkflowStatus(workflowId: string, status: WorkflowStatus): Promise<{}> {
        return this.storage.setWorkflowStatus(workflowId, status);
    }

    /**
     * @inheritDoc
     */
    public getTasksStatuses(paths: string[], workflowId: string): Promise<Statuses> {
        return this.storage.getTasksStatuses(paths, workflowId);
    }

    public getAllWorkflowsUids() {
        return this.storage.getAllWorkflowsUids();
    }

    /**
     * Delete tasks hashs and workflow hash in redis.
     *
     * @inheritDoc
     */
    public deleteWorkflow(workflowId: string): Promise<{}> {
        let self = this;
        return this.getWorkflow(workflowId)
            .then(({workflow, workflowHash}) => {
                let paths = workflow.getAllPaths();
                return Promise.all([
                    this.storage.deleteWorkflow(workflowId),
                    this.storage.deleteTasks(workflowId, paths),
                ]).then(() => {
                    if (self.deleteHandler != null) {
                        self.deleteHandler(workflowId);
                    }
                })
            });
    }

    public deleteWorkflowsByRealm(realm: string): Promise<any> {
        let self = this;
        return this.storage.deleteByField('realm', realm).then(workflowIds => {
            if (self.deleteHandler) {
                workflowIds.map(self.deleteHandler);
            }
        });
    }
}

