const Express = require('express');
const http = require('http');
var exphbs  = require('express-handlebars');

import { Jobs } from '../src/index';
import { TreeWorkflow } from '../src/workflows/tree';
import { Factory } from '../src/index.d';

const app = Express();
var server = http.Server(app);
var jobs = new Jobs({
    host: '0.0.0.0',
    port: '6380',
});

if (process.argv.length != 3) {
    console.log('Usage : node sever.js <Public JS path>');
    process.exit();
}
const publicJsPath = process.argv[2];
app.use('/js', Express.static(publicJsPath));

app.engine('handlebars', exphbs({
    layoutsDir: '../../views/layouts',
    defaultLayout: 'main',
}));
app.set('view engine', 'handlebars');

jobs.registerWorkflowGenerator('test', (data) => {
    let tasks = [
        {
            name: 'task1',
            description: 'Returns a Promise.resolve',
            execute: (arg, factory : Factory) => {
                return Promise.resolve('OK');
            },
            children: [],
        }, {
            name: 'task2',
            description: 'Update context',
            execute: (arg, factory : Factory) => {
                factory.updateContext({
                    test: {$set: "ok"}
                });
                return Promise.resolve('Context updated');
            },
            children: [],
        }, {
            name: 'task3',
            description: 'See updated context',
            execute: (arg, factory : Factory) => {
                return Promise.resolve('Nothing');
            },
            children: [],
        }, {
            name: 'task4',
            description: 'Returns a Promise.reject',
            execute:  (arg, factory : Factory) => {
                return Promise.reject('Error');
            },
            children: [],
            condition: (context) => false,
        }, {
             name: 'task5',
            description: 'Throws an Error',
            execute:  (arg, factory : Factory) => {
                 throw new Error('Error');
            },
            children: [],
        }
    ];

    return new TreeWorkflow(tasks);
});

app.get('/', function (req, res) {
    const testData = {
        payload: 'test',
    };
    jobs.createWorkflowInstance('test', testData)
        .then(workflowId => {
            res.render('../../../views/home', {
                workflowId,
            });
        });
});

jobs.setupWebsockets(server);

server.listen(4005, function () {
    console.log('Listening on http://localhost:4005');
});