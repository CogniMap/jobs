const AWS = require('aws-sdk');
const Promise = require('bluebird');
const Consumer = require('sqs-consumer');
const uuidv4 = require('uuid/v4');

const sqs = new AWS.SQS({
    apiVersion: '2012-11-05',
    region: process.env['WORKER_AWS_REGION'] || 'eu-west-1' // Only Ireland for FIFO
});

import {WorkerConfiguration, Jobs, Sqs} from '../index.d';

export function sendMessage(queueUrl, body) {
    return sqs.sendMessage({
        QueueUrl: queueUrl,
        MessageGroupId: 'worker',
        MessageDeduplicationId: uuidv4(),
        MessageBody: JSON.stringify(body)
    }).promise();
}

function getSupervisionQueueName(queueNamePrefix : string) {
    return queueNamePrefix + "_supervisionMessages";
}

function getWorkerQueueName(queueNamePrefix : string) {
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
export function waitForQueuesCreation(queueNamePrefix): Promise<{
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

export function setupWorker(queueNamePrefix: string, config: WorkerConfiguration) {
    return waitForQueuesCreation(queueNamePrefix).then(queueUrls => {
        let handler = Consumer.create({
            queueUrl: queueUrls.supervisionMessagesUrl,
            handleMessage: (message, done) => {
                let body = JSON.parse(message.Body) as Sqs.SupervisionMessage;
                console.log('[DEBUG] Receive supervision messsage : ', body);
                switch (body.type) {
                    case "runTask":
                        handleRunTaskMessage(queueUrls.workerMessagesUrl, body as Sqs.RunTaskMessage, config);
                        break;
                    default:
                        console.warn("Unknow supervision message type : " + body.type);
                }
                done();
            },
            sqs
        });
        handler.on('error', (err => {
            console.error('[Jobs] SQS Worker error : ');
            console.error(err);
        }));
        handler.start();
    })
}

export function handleRunTaskMessage(sendingQueueUrl, message: Sqs.RunTaskMessage, config: WorkerConfiguration) {
    function sendResultMessage(result) {
        return sendMessage(sendingQueueUrl, {
            type: 'result',
            taskPath: message.taskPath,
            workflowId: message.workflowId,
            result,
        } as Sqs.ResultMessage)
    }

    function sendFailMessage(error) {
        return sendMessage(sendingQueueUrl, {
            type: 'fail',
            taskPath: message.taskPath,
            workflowId: message.workflowId,
            error,
        } as Sqs.FailMessage)
    }

    function sendUpdateContextMessage(updater) {
        return sendMessage(sendingQueueUrl, {
            type: 'updateContext',
            taskPath: message.taskPath,
            workflowId: message.workflowId,
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
        return config.executor(message.taskPath, message.param, factory).then(res => {
            return sendResultMessage(res);
        });
    } else {
        console.warn('[Jobs DEBUG] Unknow task ' + message.taskPath + '. Skipping');
    }
    return Promise.resolve();
}

