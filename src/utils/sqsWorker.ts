import {debug, debug2} from "../logging";

const AWS = require('aws-sdk');
const Promise = require('bluebird');
const Consumer = require('sqs-consumer');
const uuidv4 = require('uuid/v4');

import {WorkerConfiguration, Jobs, Sqs} from '../index.d';
import {createMessageHandler} from "./sqs";

export function sendMessage(sqs, queueUrl, body) {
    return sqs.sendMessage({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(body)
    }).promise().then(() => {
        debug("WORKER", "Message " + body.type + " sent on " + queueUrl);
    });
}

function getSupervisionQueueName(queueNamePrefix: string) {
    return queueNamePrefix + "_supervisionMessages";
}

function getWorkerQueueName(queueNamePrefix: string) {
    return queueNamePrefix + "_workerMessages";
}


/**
 * Resolve to  the queue url
 *
 * WARNING : Assume there is no other queue starting with the same queue name !
 *
 * @param queueName
 * @returns {Promise<{}>}
 */
export function waitForQueuesCreation(sqs, queueNamePrefix): Promise<{
    supervisionMessagesUrl: string,
    workerMessagesUrl: string,
}> {
    function waitForQueueCreation(queueName) {
        function checkQueue() {
            return sqs.listQueues({
                QueueNamePrefix: queueName
            }).promise().then(data => {
                if (data.QueueUrls && data.QueueUrls.length > 0) {
                    let queueUrl = data.QueueUrls[0];
                    console.log('[Jobs INFO] Got URL for queue : ' + queueUrl);
                    return queueUrl;
                } else {
                    console.log('[Jobs INFO] Queue ' + queueName + ' does not exist. Waiting 5 seconds ...');
                    return new Promise((resolve, reject) => {
                        setTimeout(() => {
                            checkQueue().then(resolve).catch(reject);
                        }, 5000)
                    })
                }
            })
        }

        return checkQueue();
    }

    return Promise.all([
        waitForQueueCreation(getSupervisionQueueName(queueNamePrefix)),
        waitForQueueCreation(getWorkerQueueName(queueNamePrefix)),
    ]).then(res => {
        return {
            supervisionMessagesUrl: res[0],
            workerMessagesUrl: res[1],
        }
    })
}

function sendWorkerHello(sqs, queueUrl: string, workerUid: string) {
    return sendMessage(sqs, queueUrl, {
        type: 'workerHello',
        workerUid
    });
}

export function setupWorker(queueNamePrefix: string, config: WorkerConfiguration) {
    const sqs = new AWS.SQS({
        apiVersion: '2012-11-05',
        region: process.env['WORKER_AWS_REGION'] || 'eu-west-1', // Only Ireland for FIFO
        ... (config.awsCredentials || {})
    });
    const workerUid = uuidv4();
    let supervisionUid = null;

    return waitForQueuesCreation(sqs, queueNamePrefix).then(queueUrls => {
        debug("WORKER", "Prepare sending workerHello");
        return sendWorkerHello(sqs, queueUrls.workerMessagesUrl, workerUid).then(() => {
            let self = this;
            debug("WORKER", "workerHello sent");
            let handler = Consumer.create({
                queueUrl: queueUrls.supervisionMessagesUrl,
                visibilityTimeout: 30,
                waitTimeSeconds: 20,
                handleMessage: createMessageHandler("WORKER", (message) => {
                    let body = JSON.parse(message.Body) as Sqs.SupervisionMessage;

                    if (body.type == "supervisionHello") {
                        let supervisionChanged = supervisionUid != body.supervisionUid;
                        supervisionUid = body.supervisionUid;
                        if (supervisionChanged) {
                            return sendWorkerHello(sqs, queueUrls.workerMessagesUrl, workerUid);
                        }
                    } else {
                        // Only process messages from known supervision
                        if (supervisionUid != null && supervisionUid == body.supervisionUid) {
                            switch (body.type) {
                                case "runTask":
                                    return handleRunTaskMessage(workerUid, sqs, queueUrls.workerMessagesUrl, body as Sqs.RunTaskMessage, config);
                                default:
                                    console.warn("Unknow supervision message type : " + body.type);
                            }
                        }
                    }
                }),
                sqs
            });
            handler.on('error', (err => {
                console.error('[Jobs] SQS Worker error : ');
                console.error(err);
            }));
            debug("WORKER", "Start consuming supervision queue");
            handler.start();
        });
    })
}

export function handleRunTaskMessage(workerUid: string, sqs, sendingQueueUrl, message: Sqs.RunTaskMessage, config: WorkerConfiguration) {
    function sendResultMessage(result) {
        return sendMessage(sqs, sendingQueueUrl, {
            type: 'result',
            workerUid,
            taskPath: message.taskPath,
            workflowId: message.workflowId,
            result,
        } as Sqs.ResultMessage)
    }

    function sendFailMessage(error) {
        return sendMessage(sqs, sendingQueueUrl, {
            type: 'fail',
            taskPath: message.taskPath,
            workflowId: message.workflowId,
            workerUid,
            error,
        } as Sqs.FailMessage)
    }

    function sendUpdateContextMessage(updater) {
        return sendMessage(sqs, sendingQueueUrl, {
            type: 'updateContext',
            taskPath: message.taskPath,
            workflowId: message.workflowId,
            workerUid,
            updater,
        } as Sqs.UpdateContextMessage)
    }

    if (config.knownTaskPaths.indexOf(message.taskPath) > -1) {
        let factory = {
            context: message.context,
            updateContext(updater) {
                return sendUpdateContextMessage(updater);
            }
        } as any;
        try {
            return config.executor(message.taskPath, message.param, factory)
                .catch(err => {
                    return sendFailMessage(err);
                })
                .then(res => {
                    return sendResultMessage(res);
                });
        } catch (err) {
            return sendFailMessage(err);
        }
    } else {
        debug('WORKER', 'Unknow task ' + message.taskPath + '. Skipping');
    }
    return Promise.resolve();
}

