import {Controller} from './controllers/Controller';

const uniqid = require('uniqid');

import {Backend} from './backends/Backend';
import {
    BackendConfiguration, SqsBackendConfiguration, KueBackendConfiguration, SyncBackendConfiguration,
    ControllerConfiguration, WebsocketControllerConfig,
    WorkflowInstance, WorkflowGenerator,
} from './index.d';
import {WebsocketController} from './controllers/WebsocketController';
import {KueBackend} from './backends/KueBackend';
import {SyncBackend} from './backends/SyncBackend';
import {SqsBackend} from "./backends/SqsBackend";

export {setupWorker} from './utils/sqsWorker';
export const Workflows = require('./workflows');

/**
 * Main class to setup a controller and a backend.
 */
export class Jobs {
    private backend: Backend;
    private controller: Controller;

    public static BACKEND_KUE = 'backend_kue';
    public static BACKEND_SQS = 'backend_sqs';
    public static BACKEND_SYNC = 'backend_sync';

    public static CONTROLLER_BASE = 'controller_base';
    public static CONTROLLER_WEBSOCKET = 'controller_websocket';

    public constructor(backend: {
        type: string,
        config?: BackendConfiguration
    }, controller ?: {
        type: string,
        config?: ControllerConfiguration
    }) {
        backend = Object.assign({}, {config: {}}, backend);
        controller = Object.assign({}, {config: {}, type: Jobs.CONTROLLER_BASE}, controller || {});

        // Initialize backend
        switch (backend.type) {
            case Jobs.BACKEND_KUE:
                this.backend = new KueBackend(backend.config as KueBackendConfiguration);
                break;
            case Jobs.BACKEND_SQS:
                this.backend = new SqsBackend(backend.config as SqsBackendConfiguration);
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
     * @param realm
     * @param workflowGenerator
     * @param workflowData Is the data used by the workflow generator
     * @param options
     */
    public createWorkflowInstance(realm: string, workflowGenerator: string, workflowData: any, options: {
        baseContext?: any,
        execute?: boolean,
        ephemeral?: boolean,
        name?: string
    } = {}): Promise<string> {
        let self = this;
        let workflowId = uniqid();
        options = Object.assign({}, {
            baseContext: {},
            execute: false,
            ephemeral: false,
            name: '',
            generator: workflowGenerator,
        }, options);
        return self.backend.initializeWorkflow(realm, workflowGenerator, workflowData, workflowId, options as any)
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
    public executeAllTasks(workflowId: string, argument = null): Promise<any> {
        return this.controller.executeAllTasks(workflowId, argument);
    }

    /**
     * Cf Backend::updateWorkflow.
     *
     * Notify watchers of this workflow instance, if any
     *
     * @param workflowUpdater An updater of a WorkflowHash object
     */
    public updateWorkflow(workflowId: string, workflowUpdater): Promise<any> {
        return this.backend.updateWorkflow(workflowId, workflowUpdater)
            .then(() => {
                this.controller.onWorkflowUpdate(workflowId);
            });
    }

    /**
     * Proxy to the controller
     */
    public executeOneTask(workflowId: string, taskPath: string, argument = null) {
        return this.controller.executeOneTask(workflowId, taskPath, argument);
    }

    /**
     * Proxy to the backend.
     */
    public registerWorkflowGenerator(name: string, generator: WorkflowGenerator) {
        return this.backend.registerWorkflowGenerator(name, generator);
    }

    /**
     * Get all workflow instances.
     *
     * WARNING : This method should not be used in production !
     * It might ruined performances.
     */
    public getAllWorkflows(): Promise<string[]> {
        return this.backend.getAllWorkflowsUids();
    }

    public destroyWorkflow(workflowId: string) {
        return this.backend.deleteWorkflow(workflowId);
    }

    public destroyWorkflowsByRealm(realm: string) {
        return this.backend.deleteWorkflowsByRealm(realm);
    }
}
