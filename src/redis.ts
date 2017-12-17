const RedisClass = require('redis');
const Promise = require('bluebird');
Promise.promisifyAll(RedisClass.RedisClient.prototype);
Promise.promisifyAll(RedisClass.Multi.prototype);

import {
    WorkflowHash, TaskHash,
    Statuses, TaskStatus, WorkflowStatus,
} from './index.d';
import { update } from './immutability';

/**
 * Interface to the redis client.
 * JSON stringify/parse all values.
 *
 * Also promisify all functions.
 */
export class Redis
{
    private redis = null;

    public constructor(redisConfig)
    {
        redisConfig = Object.assign({}, {
            port: 6379,
        }, redisConfig);
        this.redis = RedisClass.createClient(redisConfig);
        this.redis.on('error', function (err) {
            console.log('[REDIS ERROR] ' + err);
        });
    }

    /********************************************************
     * Commons
     *******************************************************/

    /**
     * Jsonify all values of the given object.
     */
    private redify(obj)
    {
        let newObj = {};
        for (let key in obj) {
            let value = obj[key];
            if (value === undefined) {
                value = null;
            }
            newObj[key] = JSON.stringify(obj[key]);
        }
        return newObj;
    }

    /**
     * Opposite of redify().
     */
    private parse(obj)
    {
        let newObj = {};
        for (let key in obj) {
            let value = obj[key];
            newObj[key] = value == 'undefined' ? null : JSON.parse(obj[key]);
        }
        return newObj;
    }

    /********************************************************
     * Workflows
     *******************************************************/

    public initWorkflow(workflowGenerator : string, generatorData : any, paths : string[], workflowId : string,
                        baseContext)
    {
        let query = this.redis.multi();
        query.hmset('workflow_' + workflowId, this.redify({
            status: 'working' as WorkflowStatus,

            generator: workflowGenerator,
            generatorData,

            baseContext,
        } as WorkflowHash));
        for (let path of paths) {
            query.hmset('workflowTask_' + workflowId + '_' + path, this.redify({
                status: 'inactive',
                body: null,
                argument: null,
                context: null,
                contextUpdaters: [],
                executionTime: null,
            } as TaskHash));
        }

        return query.execAsync();
    }

    public getWorkflow(workflowId : string) : Promise<WorkflowHash>
    {
        return this.redis.hgetallAsync('workflow_' + workflowId)
                   .then(this.parse);
    }

    public saveWorkflow(workflowId : string, workflow : WorkflowHash) : Promise<{}>
    {
        return this.redis.hmset('workflow_' + workflowId, this.redify(workflow));
    }

    public getWorkflowField(workflowId : string, field : string) : Promise<any>
    {
        return this.redis.hgetAsync('workflow_' + workflowId, field)
                   .then(value => {
                       if (value == null) {
                           throw new Error('Unknow workflow : "' + workflowId + '"');
                       }
                       return JSON.parse(value);
                   });
    }

    public getWorkflowName(workflowId : string) : Promise<string>
    {
        return this.getWorkflowField(workflowId, 'workflowName');
    }

    public setWorkflowStatus(workflowId, status : WorkflowStatus)
    {
        return this.redis.hsetAsync('workflow_' + workflowId, 'status', JSON.stringify(status));
    }

    /********************************************************
     * Tasks
     *******************************************************/

    public setTaskStatus(workflowId : string, taskPath : string, status : TaskStatus)
    {
        return this.redis.hsetAsync(this.getTaskHash(workflowId, taskPath), 'status', JSON.stringify(status));
    }

    private getTaskHash(workflowId : string, taskPath : string)
    {
        return 'workflowTask_' + workflowId + '_' + taskPath;
    }

    public getTask(workflowId : string, taskPath : string) : Promise<TaskHash>
    {
        let self = this;
        return this.redis.hgetallAsync(this.getTaskHash(workflowId, taskPath))
                   .then(hash => {
                       return self.parse(hash);
                   });
    }

    public setTask(workflowId : string, taskPath : string, task : TaskHash) : Promise<TaskHash>
    {
        return this.redis.hmsetAsync(this.getTaskHash(workflowId, taskPath), this.redify(task))
                   .then(() => task);
    }

    public updateTask(workflowId : string, taskPath : string, updater) : Promise<TaskHash>
    {
        let self = this;
        return this.getTask(workflowId, taskPath)
                   .then(taskHash => {
                       let newTaskHash = update(taskHash, updater);
                       return self.setTask(workflowId, taskPath, newTaskHash);
                   });
    }

    /**
     * Get the status of all tasks of the given workflow (in a flat array).
     */
    public getTasksStatuses(paths : string[], workflowId : string) : Promise<Statuses>
    {
        let self = this;
        return new Promise((resolve, reject) => {
            let query = self.redis.multi();
            for (let path of paths) {
                query.hgetall(this.getTaskHash(workflowId, path));
            }

            query.exec(function (err, replies) {
                if (err) {
                    reject(err);
                } else {
                    let statuses = {};
                    paths.map((path, i) => {
                        statuses[path] = self.parse(replies[i]);
                    });
                    resolve(statuses);
                }
            });
        });
    }
}
