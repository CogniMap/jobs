import {MysqlConfig, TasksStorageConfig,DynamodbIndexConfig, DynamodbTasksConfig, RedisConfig} from '../index.d';
import {Redis} from "./tasks/Redis";
import {DynamoDb as TasksDynamodb} from "./tasks/DynamoDb";
import {TasksStorage} from './tasks/TasksStorage';
import {IndexStorage} from "./index/IndexStorage";
import {MysqlStorage} from "./index/MysqlStorage";
import {DynamoDb as IndexDynamodb} from './index/DynamoDb';

export function getTasksStorageInstance(config : TasksStorageConfig) : TasksStorage {
    if (config.type == 'redis') {
        return new Redis(config as RedisConfig);
    } else if (config.type == 'dynamodb') {
        return new TasksDynamodb(config as DynamodbTasksConfig);
    } else {
        throw new Error("Unknow tasks storage type : " + config.type);
    }
}

export function getIndexStorageInstance(config) : IndexStorage {
    if (config.type == 'mysql') {
        return new MysqlStorage(config as MysqlConfig);
    } else if (config.type == 'dynamodb') {
        return new IndexDynamodb(config as DynamodbIndexConfig);
    } else {
        throw new Error("Unknow index storage type : " + config.type);
    }
}

