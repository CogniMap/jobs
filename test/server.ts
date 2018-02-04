const Express = require('express');
const http = require('http');
const exphbs = require('express-handlebars');
const bodyParser = require('body-parser');

import { Jobs } from '../src/index';
import { TreeWorkflow } from '../src/workflows/TreeWorkflow';
import { Factory, WebsocketControllerConfig } from '../src/index.d';

const app = Express();
let server = http.Server(app);
const mysqlConfig = {
    host: '0.0.0.0',
    port: 3305,
    username: 'admin',
    password: 'password',
};

let webSocketJobs = new Jobs(mysqlConfig, {
    type: Jobs.BACKEND_ASYNC,
    config: {
        redis: {
            host: '0.0.0.0',
            port: 6380,
        },
    },
}, {
    type: Jobs.CONTROLLER_WEBSOCKET,
    config: {
        server,
    } as WebsocketControllerConfig,
});

let debugJobs = new Jobs(mysqlConfig, {
    type: Jobs.BACKEND_SYNC,
}, {
    type: Jobs.CONTROLLER_BASE,
});


if (process.argv.length != 3) {
    console.log('Usage : node sever.js <Public JS path>');
    process.exit();
}
const publicJsPath = process.argv[2];
console.log('Using public js : ' + publicJsPath);
app.use('/js', Express.static(publicJsPath));

app.engine('handlebars', exphbs({
    layoutsDir: '../../views/layouts',
    defaultLayout: 'main',
}));
app.set('view engine', 'handlebars');

const generator = (data) => {
    let tasks = [
        {
            name: 'task1',
            description: 'Returns a Promise.resolve',
            execute: (arg, factory : Factory) => {
                console.log('Initial argument : ');
                console.log(arg);
                return Promise.resolve('OK');
            },
            children: [],
        }, {
            name: 'task2',
            description: 'Update context',
            execute: (arg, factory : Factory) => {
                factory.updateContext({
                    test: {$set: 'ok'},
                });
                return Promise.resolve('Context updated');
            },
            children: [],
        }, {
            name: 'task3',
            description: 'See updated context',
            execute: (arg, factory : Factory) => {
                return new Promise((resolve, reject) => {
                    console.log('Start timeout ...');
                    setTimeout(() => {
                        console.log("... done");
                        resolve('Nothing');
                    }, 3000);
                });
            },
            children: [],
        }, {
            name: 'task4',
            description: 'Returns a Promise.reject',
            execute: (arg, factory : Factory) => {
                console.log('task4 (will fail)');
                return Promise.reject('Error');
            },
            children: [],
            condition: (context) => false,
        }, {
            name: 'task5',
            description: 'Throws an Error',
            execute: (arg, factory : Factory) => {
                throw new Error('Error');
            },
            children: [],
        },
    ];

    return new TreeWorkflow(tasks);
};

webSocketJobs.registerWorkflowGenerator('test', generator);
debugJobs.registerWorkflowGenerator('test', generator);

app.get('/', function (req, res) {
    const testData = {
        payload: 'test',
    };
    webSocketJobs.createWorkflowInstance('test', testData, {name: 'test_workflow'})
                 .then(workflowId => {
                     res.render('../../../views/home', {
                         workflowId,
                     });
                 });
});

app.post('/executeAllTasks', bodyParser.json(), function (req, res) {
    let workflowId = req.body.workflowId;
    let initialArg = {};
    console.log('Execute all tasks');
    webSocketJobs.executeAllTasks(workflowId, initialArg)
                 .then(workflowId => {
                     res.render('../../../views/home', {
                         workflowId,
                     });
                 })
                 .catch(err => {
                     res.render('../../../views/error', {
                         error: JSON.stringify(err),
                     });
                 });
});


app.post('/executeAllTasks', bodyParser.json(), function (req, res) {
    let workflowId = req.body.workflowId;
    let initialArg = {};
    console.log('Execute all tasks');
    webSocketJobs.executeAllTasks(workflowId, initialArg)
                 .then(workflowId => {
                     res.render('../../../views/home', {
                         workflowId,
                     });
                 })
                 .catch(err => {
                     res.render('../../../views/error', {
                         error: JSON.stringify(err),
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
