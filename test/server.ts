import {debug} from "../src/logging";

const Express = require('express');
const uuidv4 = require('uuid/v4');
const http = require('http');
const exphbs = require('express-handlebars');
const bodyParser = require('body-parser');
const intersection = require('lodash/intersection');

import {setupWorker} from "../src/utils/sqsWorker";
import {Jobs} from '../src/index';
import {TreeWorkflow} from '../src/workflows/TreeWorkflow';
import {SqsBackendConfiguration, ReducedFactory, Factory, WebsocketControllerConfig, RedisConfig} from '../src/index.d';


/**
 * Usage :
 *
 *  node server.js <storage_type> <frontend_webroot>
 */

const app = Express();
let server = http.Server(app);
const redisConfig = {
    host: '0.0.0.0',
    port: 6380,
};
const dynamodbConfig = {
    type: 'dynamodb',
    region: 'eu-west-3',
    tableName: 'cognimap-test'
}


const storageType = process.argv[2]; // "aws" or "redis"

let webSocketJobs = new Jobs({
    type: Jobs.BACKEND_SQS,
    config: {
        tasksStorage: storageType == "redis" ? ({
            type: 'redis',
            ...redisConfig
        } as RedisConfig) : dynamodbConfig as any,

        queueNamesPrefix: 'testJobs',
        workers: [
            {
                name: 'jobs',
            }
        ],
        region: 'eu-west-1', // Only Ireland for FIFO queues
    } as SqsBackendConfiguration,
}, {
    type: Jobs.CONTROLLER_WEBSOCKET,
    config: {
        server,
        onError: (workflowId, taskPath, err) => {
            console.log('Workflow error', workflowId, taskPath, err);
        },
        onComplete: (workflowId) => {
            console.log('Workflow (websocket) complete', workflowId);
        }
    } as WebsocketControllerConfig,
} as any);

let debugJobs = new Jobs({
    type: Jobs.BACKEND_SYNC,
}, {
    type: Jobs.CONTROLLER_BASE,
    config: {
        onComplete: (workflowId) => {
            console.log('Workflow (default) complete', workflowId);
        }
    }
});

if (process.argv.length != 4) {
    console.log('Usage : node sever.js <Storage type> <Public JS path>');
    process.exit();
}
const publicJsPath = process.argv[3];
console.log('Using public js : ' + publicJsPath);
app.use('/js', Express.static(publicJsPath));

app.engine('handlebars', exphbs({
    layoutsDir: '../../views/layouts',
    defaultLayout: 'main',
}));
app.set('view engine', 'handlebars');

setupWorker('testJobs_jobs', {
    knownTaskPaths: [
        '#.task1',
        '#.task2',
        '#.task3',
        '#.task4',
        '#.task5',
        '#.task6',
    ],
    executor: sqsExecuteTask
});

const generator1 = (data) => {
    let tasks = [
        {
            name: 'task1',
            description: 'Returns a Promise.resolve',
            children: [],
        }, {
            name: 'task2',
            description: 'Update context',
            children: [],
            contextVar: 'test';
},
    {
        name: 'task3',
            description
    :
        'See updated context',
            children
    :
        [],
    }
,
    {
        name: 'task4',
            description
    :
        'Skipped task',
            children
    :
        [],
    }
,
    {
        name: 'task5',
            description
    :
        'Returns a Promise.reject',
            children
    :
        [],
    }
,
    {
        name: 'task6',
            description
    :
        'Throws an Error',
            children
    :
        [],
    }
,
]
    ;

    return new TreeWorkflow(tasks);
};

export function sqsExecuteTask(taskPath: string, arg, factory: ReducedFactory<any>) {
    switch (taskPath) {
        case "#.task1":
            // Returns a Promise.resolve
            debug('TASK', 'Start #.task1');
            debug('TASK', 'Initial argument : ');
            debug('TASK', arg);
            return new Promise((resolve, reject) => {
                setTimeout(() => {
                    debug('TASK', '#.task1 done');
                    resolve('OK');
                }, 5000);
            });
        case "#.task2":
            // Update context with context var
            debug('TASK', 'Start #.task2');
            return new Promise((resolve, reject) => {
                setTimeout(() => {
                    console.log('Context will be updated with contextVar');
                    resolve('ok');
                    console.log('[DEBUG] #.task2 done');
                }, 5000);
            });
        case "#.task3":
            // See updated context
            return new Promise((resolve, reject) => {
                debug('TASK', 'Start #.task3');
                console.log('Context : ', factory.context);
                debug('TASK', 'Start timeout ...');
                setTimeout(() => {
                    debug('TASK', '#.task3 done');
                    resolve('Nothing');
                }, 10000);
            });
        case "#.task4":
            // Skipped task
            return Promise.reject('Should not happened');
        case "#.task5":
            // Returns Promise.reject
            debug('TASK', 'task4 (will fail)');
            return Promise.reject('Error');
        case "#.task6":
            // Throw an error
            throw new Error('Error');
    }
}

interface Context2 {

}

const generator2 = (data) => {
    let tasks = [
        {
            name: 'task1',
            description: 'Returns a Promise.resolve',
            execute: (arg, factory: Factory<Context2>) => {
                console.log('Initial argument : ');
                console.log(arg);
                return Promise.resolve('OK');
            },
            children: [],
        }, {
            name: 'task2',
            description: 'Update context',
            execute: (arg, factory: Factory<Context2>) => {
                return factory.updateContext({
                    test: {$set: 'ok'},
                }).then(() => {
                    return Promise.resolve('Context updated');
                })
            },
            children: [],
        },
    ];

    return new TreeWorkflow(tasks);
};


webSocketJobs.registerWorkflowGenerator('test1', generator1);
webSocketJobs.registerWorkflowGenerator('test2', generator2);
debugJobs.registerWorkflowGenerator('test', generator1);

app.get('/', function (req, res) {
    const testData = {
        payload: 'test',
    };
    let realm = uuidv4();
    Promise.all([
        // Single workflow test
        webSocketJobs.createWorkflowInstance(realm, 'test1', testData, {name: 'test_workflow1'}),

        // Multi worklfows test
        webSocketJobs.createWorkflowInstance(realm, 'test2', testData, {
            name: 'test_workflow2',
            ephemeral: true,
        }),
        webSocketJobs.createWorkflowInstance(realm, 'test2', testData, {
            name: 'test_workflow3',
            ephemeral: true,
        }),
    ])

        .then(workflowIds => {
            res.render('../../../views/home', {
                realm,
                singleWorkflowId: workflowIds[0],
                multiWorkflowIds: JSON.stringify([workflowIds[1], workflowIds[2]]),
                awsWorkflowId: workflowIds[3]
            });
        });
});

function sendResults(promise, res) {
    promise
        .then(() => {
            res.json({result: 'ok'});
        })
        .catch((err) => {
            console.log(err);
            res.json({result: 'failed'});
        });
}

/**
 * Execute all tasks of a single workflow.
 */
app.post('/executeAllTasksSingle', bodyParser.json(), function (req, res) {
    let workflowId = req.body.workflowId;
    let initialArg = {};
    console.log('Execute all tasks');
    sendResults(webSocketJobs.executeAllTasks(workflowId, initialArg), res);
});


/**
 * Execute all tasks of several workflows
 */
app.post('/executeAllTasksMulti', bodyParser.json(), function (req, res) {
    let workflowIds = req.body.workflowIds;
    const initialArg = {};
    console.log('Execute all tasks');
    sendResults(Promise.all(workflowIds.map(workflowId => {
        webSocketJobs.executeAllTasks(workflowId, initialArg);
    })), res);
});

/**
 * Check if the given workflow exist.
 */
app.post('/hasWorkflows', bodyParser.json(), function (req, res) {
    let workflowIds = req.body.workflowIds;
    webSocketJobs.getAllWorkflows()
        .then(allWorkflowsIds => {
            res.json({
                existing: intersection(workflowIds, allWorkflowsIds)
            });
        });
});

/**
 * Delete workflows by realm
 */
app.post('/deleteByRealm', bodyParser.json(), function (req, res) {
    let realm = req.body.realm;
    webSocketJobs.destroyWorkflowsByRealm(realm)
        .then(() => {
            res.json({
                result: 'ok'
            });
        });
});

app.get('/testSync', function (req, res) {
    const testData = {
        payload: 'test',
    };
    let realm = uuidv4();
    debugJobs.createWorkflowInstance(realm, 'test', testData, {name: 'test_workflow'})
        .then(workflowId => {
            debugJobs.executeAllTasks(workflowId)
                .then(() => {
                    res.json({
                        result: 'ok (resolved)',
                        realm,
                    });
                })
                .catch(() => {
                    res.json({
                        result: 'ok (rejected)',
                        realm,
                    });
                });
        });
});

server.listen(4005, function () {
    console.log('Listening on http://localhost:4005');
});
