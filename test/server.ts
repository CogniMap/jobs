const Express = require('express');
const http = require('http');
const exphbs = require('express-handlebars');
const bodyParser = require('body-parser');
const intersection = require('lodash/intersection');

import {Jobs} from '../src/index';
import {TreeWorkflow} from '../src/workflows/TreeWorkflow';
import {MysqlConfig, Factory, WebsocketControllerConfig, RedisConfig} from '../src/index.d';


/**
 * Usage :
 *
 *  node server.js <storage_type> <frontend_webroot>
 */

const app = Express();
let server = http.Server(app);
const mysqlConfig = {
    type: 'mysql',
    host: '0.0.0.0',
    port: 3305,
    username: 'admin',
    password: 'password',
} as MysqlConfig;
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

let webSocketJobs = new Jobs(mysqlConfig, {
    type: Jobs.BACKEND_ASYNC,
    config: {
        redis: redisConfig,
        tasksStorage: storageType == "redis" ? ({
            type: 'redis',
            ...redisConfig
        } as RedisConfig) : dynamodbConfig as any,
    },
}, {
    type: Jobs.CONTROLLER_WEBSOCKET,
    config: {
        server,
    } as WebsocketControllerConfig,
} as any);

let debugJobs = new Jobs(mysqlConfig, {
    type: Jobs.BACKEND_SYNC,
}, {
    type: Jobs.CONTROLLER_BASE,
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

const generator1 = (data) => {
    let tasks = [
        {
            name: 'task1',
            description: 'Returns a Promise.resolve',
            execute: (arg, factory: Factory) => {
                console.log('Initial argument : ');
                console.log(arg);
                return Promise.resolve('OK');
            },
            children: [],
        }, {
            name: 'task2',
            description: 'Update context',
            execute: (arg, factory: Factory) => {
                factory.updateContext({
                    test: {$set: 'ok'},
                });
                return Promise.resolve('Context updated');
            },
            children: [],
        }, {
            name: 'task3',
            description: 'See updated context',
            execute: (arg, factory: Factory) => {
                return new Promise((resolve, reject) => {
                    console.log('Start timeout ...');
                    setTimeout(() => {
                        console.log('... done');
                        resolve('Nothing');
                    }, 1000);
                });
            },
            children: [],
        }, {
            name: 'task4',
            description: 'Skipped task',
            execute: (arg, factory: Factory) => {
                return Promise.reject('Should not happened');
            },
            children: [],
            condition: (context) => false,
        }, {
            name: 'task5',
            description: 'Returns a Promise.reject',
            execute: (arg, factory: Factory) => {
                console.log('task4 (will fail)');
                return Promise.reject('Error');
            },
            children: [],
        }, {
            name: 'task6',
            description: 'Throws an Error',
            execute: (arg, factory: Factory) => {
                throw new Error('Error');
            },
            children: [],
        },
    ];

    return new TreeWorkflow(tasks);
};

const generator2 = (data) => {
    let tasks = [
        {
            name: 'task1',
            description: 'Returns a Promise.resolve',
            execute: (arg, factory: Factory) => {
                console.log('Initial argument : ');
                console.log(arg);
                return Promise.resolve('OK');
            },
            children: [],
        }, {
            name: 'task2',
            description: 'Update context',
            execute: (arg, factory: Factory) => {
                factory.updateContext({
                    test: {$set: 'ok'},
                });
                return Promise.resolve('Context updated');
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
    Promise.all([
        // Single workflow test
        webSocketJobs.createWorkflowInstance('test1', testData, {name: 'test_workflow1'}),

        // Multi worklfows test
        webSocketJobs.createWorkflowInstance('test2', testData, {
            name: 'test_workflow2',
            ephemeral: true,
        }),
        webSocketJobs.createWorkflowInstance('test2', testData, {
            name: 'test_workflow3',
            ephemeral: true,
        }),
    ])

        .then(workflowIds => {
            res.render('../../../views/home', {
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
        .then(allWorkflows => {
            let allWorkflowIds = allWorkflows.map(workflowInstance => workflowInstance.id);
            res.json({
                existing: intersection(workflowIds, allWorkflowIds)
            });
        });
});

app.get('/testSync', function (req, res) {
    const testData = {
        payload: 'test',
    };
    debugJobs.createWorkflowInstance('test', testData, {name: 'test_workflow'})
        .then(workflowId => {
            debugJobs.executeAllTasks(workflowId)
                .then(() => {
                    res.json({result: 'ok (resolved)'});
                })
                .catch(() => {
                    res.json({result: 'ok (rejected)'});
                });
        });
});

server.listen(4005, function () {
    console.log('Listening on http://localhost:4005');
});
