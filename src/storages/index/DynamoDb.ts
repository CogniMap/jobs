import {IndexStorage} from "./IndexStorage";
import {DynamodbIndexConfig} from '../../index.d';

const AWS = require('aws-sdk');

/**
 * This storage can work with the same dynamodb table than the tasks dynamodb storage.
 *
 * Indeed, all workflows instances are stored in a single item, index with the key "workflows";
 */
export class DynamoDb extends IndexStorage {
    private tableName: string;
    private dynamodb;

    public constructor(config: DynamodbIndexConfig) {
        super();
        this.dynamodb = new AWS.DynamoDB({
            apiVersion: '2012-08-10',
            region: config.region,
        });
        this.tableName = config.tableName;
    }

    public getAll() {
        return this.dynamodb.getItem({
            TableName: this.tableName,
            Key: {
                Key: {
                    S: 'workflows'
                }
            }
        }).promise().then(data => {
            if (data.Item == null) {
                return [];
            } else {
                return JSON.parse(data.Item.Workflows.S);
            }
        })
    }

    /**
     * Replace the old item (or create it if it does not exist yet) with the new workflow.
     *
     * @param {{id: number; name: string}} workflow
     */
    public create(workflow) {
        return this.getAll().then(workflows => {
            workflows.push(workflow);

            return this.dynamodb.putItem({
                TableName: this.tableName,
                Item: {
                    Key: {
                        S: 'workflows'
                    },
                    Workflows: {
                        S: JSON.stringify(workflows)
                    }
                }
            }).promise();
        });
    }
}