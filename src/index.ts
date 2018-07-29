import { Controller } from './controllers/Controller';

const uniqid = require('uniqid');

import { Backend } from './backends/Backend';
import {
    IndexStorageConfig,
    BackendConfiguration, AsyncBackendConfiguration, SyncBackendConfiguration,
    ControllerConfiguration, WebsocketControllerConfig,
    WorkflowInstance, WorkflowGenerator,
} from './index.d';
import { WebsocketController } from './controllers/WebsocketController';
import { AsyncBackend } from './backends/AsyncBackend';
import { SyncBackend } from './backends/SyncBackend';
import {IndexStorage} from "./storages/index/IndexStorage";
import {getIndexStorageInstance} from "./storages/factory";

export const Workflows = require('./workflows');

/**
 * Main class to setup a controller and a backend.
 */
export class Jobs
{
    private database : IndexStorage;
    private backend : Backend;
    private controller : Controller;

    public static BACKEND_ASYNC = 'backend_async';
    public static BACKEND_SYNC = 'backend_sync';

    public static CONTROLLER_BASE = 'controller_base';
    public static CONTROLLER_WEBSOCKET = 'controller_websocket';

    public constructor(indexStorage : IndexStorageConfig, backend : {
        type : string,
        config ? : BackendConfiguration
    }, controller ? : {
        type : string,
        config ? : ControllerConfiguration
    })
    {
        this.database = getIndexStorageInstance(indexStorage);
        backend = Object.assign({}, {config: {}}, backend);
        controller = Object.assign({}, {config: {}, type: Jobs.CONTROLLER_BASE}, controller || {});

        // Initialize backend
        switch (backend.type) {
            case Jobs.BACKEND_ASYNC:
                this.backend = new AsyncBackend(backend.config as AsyncBackendConfiguration);
                break;
            case Jobs.BACKEND_SYNC:
                this.backend = new SyncBackend(backend.config as SyncBackendConfiguration);
                break;
            default:
                throw new Error("Unknow backend : " + backend.type);
        }

        // Initialize controller
        switch (controller.type) {
            case Jobs.CONTROLLER_WEBSOCKET:
                this.controller = new WebsocketController(this.backend, controller.config as WebsocketControllerConfig);
                break;
            case Jobs.CONTROLLER_BASE:
                this.controller = new Controller(this.backend, controller.config);
                break;
            default:
                throw new Error("Unknow controller : " + controller.type);
        }
    }

    /**
     * This function create a new workflow instance, and returns its unique id.
     *
     * @param workflowGenerator
     * @param workflowData Is the data used by the workflow generator
     * @param options
     */
    public createWorkflowInstance(workflowGenerator : string, workflowData : any, options : {
        baseContext ? : any,
        execute ? : boolean,
        ephemeral ? : boolean,
        name ? : string
    } = {}) : Promise<string>
    {
        let self = this;
        let workflowId = uniqid();
        options = Object.assign({}, {
            baseContext: {},
            execute: false,
            ephemeral: false,
            name: '',
            generator: workflowGenerator,
        }, options);
        return this.database.create({
            id: workflowId,
            name: options.name,
        })
                   .then(workflowInstance => {
                       return self.backend.initializeWorkflow(workflowGenerator, workflowData, workflowId, options as any);
                   })
                   .then(() => {
                       if (options.execute) {
                           return self.controller.executeAllTasks(workflowId)
                                      .then(() => workflowId);
                       }

                       return workflowId;
                   });
    }

    /**
     * Proxy to the controller
     */
    public executeAllTasks(workflowId : string, argument = null) : Promise<any>
    {
        return this.controller.executeAllTasks(workflowId, argument);
    }

    /**
     * Cf Backend::updateWorkflow.
     *
     * Notify watchers of this workflow instance, if any
     *
     * @param workflowUpdater An updater of a WorkflowHash object
     */
    public updateWorkflow(workflowId : string, workflowUpdater) : Promise<any>
    {
        return this.backend.updateWorkflow(workflowId, workflowUpdater)
                   .then(() => {
                       this.controller.onWorkflowUpdate(workflowId);
                   });
    }

    /**
     * Proxy to the controller
     */
    public executeOneTask(workflowId : string, taskPath : string, argument = null)
    {
        return this.controller.executeOneTask(workflowId, taskPath, argument);
    }

    /**
     * Proxy to the backend.
     */
    public registerWorkflowGenerator(name : string, generator : WorkflowGenerator)
    {
        return this.backend.registerWorkflowGenerator(name, generator);
    }

    /**
     * Get all workflow instances.
     */
    public getAllWorkflows() : Promise<WorkflowInstance[]>
    {
        return this.database.getAll();
    }

    public destroyWorkflow(workflowId : string) {
        this.backend.deleteWorkflow(workflowId);
    }
}
