import {StorageConfig,DynamodbConfig, RedisConfig} from '../index.d';
import {Redis} from "./Redis";
import {DynamoDb as TasksDynamodb} from "./DynamoDb";
import {Storage} from './Storage';

export function getTasksStorageInstance(config : StorageConfig) : Storage {
    if (config.type == 'redis') {
        return new Redis(config as RedisConfig);
    } else if (config.type == 'dynamodb') {
        return new TasksDynamodb(config as DynamodbConfig);
    } else {
        throw new Error("Unknow tasks storage type : " + config.type);
    }
}

