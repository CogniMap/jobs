const AWS = require('aws-sdk');

import {DynamodbTasksConfig} from '../../index.d';
import {TasksStorage} from './TasksStorage';

/**
 * Jsonify values. Hence dynamodb items only contain string values
 *
 * Primary key of items is the attribute "Key".
 */
export class DynamoDb extends TasksStorage {
    private tableName: string;
    private dynamodb;

    public constructor(dynamodbConfig: DynamodbTasksConfig) {
        super();
        this.dynamodb = new AWS.DynamoDB({
            apiVersion: '2012-08-10',
            region: dynamodbConfig.region
        });
        this.tableName = dynamodbConfig.tableName;
    }

    /**
     * If the primary key already exists, DynamoDb will replace the old item.
     *
     * @param {string} key
     * @param data
     */
    public set(key: string, data) {
        return this.dynamodb.putItem({
            Item: {
                ... this.makeItem(data),
                Key: {
                    S: key
                }
            },
            TableName: this.tableName
        }).promise();
    }

    public bulkSet(values: {
        key: string,
        data: any
    }[]) {
        let self = this;
        return this.dynamodb.batchWriteItem({
            RequestItems: {
                [this.tableName]: values.map(value => {
                    return {
                        PutRequest: {
                            Item: {
                                ... self.makeItem(value.data),
                                Key: {S: value.key}
                            }
                        }
                    }
                })
            }
        }).promise();
    }

    /**
     * We update an item : must read first, and then replace the item.
     *
     * @param {string} key
     * @param {string} field
     * @param value
     */
    public setField(key: string, field, value) {
        return this.get(key).then(data => {
            data[field] = value;
            return this.set(key, data);
        })
    }

    public get(key: string) {
        let self = this;
        return this.dynamodb.getItem({
            TableName: this.tableName,
            Key: {
                Key: {
                    S: key
                }
            }
        }).promise().then(data => {
            return self.parse(data.Item);
        })
    }

    public getField(key: string, field: string) {
        return this.get(key).then(data => data[field]);
    }

    public bulkGet(keys: string[]) {
        let self = this;
        return this.dynamodb.batchGetItem({
            RequestItems: {
                [this.tableName]: {
                    Keys: keys.map(key => ({
                        Key: {S: key}
                    }))
                }
            }
        }).promise().then(data => {
            let items = data.Responses[self.tableName];
            return items.map(self.parse);
        })
    }

    public delete(key: string) {
        return this.dynamodb.deleteItem({
            TableName: this.tableName,
            Key: {
                Key: {
                    S: key
                }
            }
        }).promise();
    }

    public bulkDelete(keys: string[]) {
        return this.dynamodb.batchWriteItem({
            RequestItems: {
                [this.tableName]: keys.map(key => ({
                    DeleteRequest: {
                        Key: {
                            Key: {S: key}
                        }
                    }
                }))
            }
        })
    }

    /********************************************************
     * Commons
     *******************************************************/

    private makeItem(obj) {
        let item = {};
        for (let key in obj) {
            item[key] = {
                S: JSON.stringify(obj[key])
            }
        }
        return item;
    }

    private parse(item) {
        let newObj = {};
        for (let key in item) {
            if (key == "Key") {
                continue;
            }

            let value = item[key];
            newObj[key] = value['S'] == 'undefined' ? null : JSON.parse(value["S"]);
        }
        return newObj;
    }
}