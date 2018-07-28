const AWS = require('aws-sdk');
const dynamodb = new AWS.DynamoDB({apiVersion: '2012-08-10'});

export class DynamoDb extends Storage
{
    private table: string;

    public constructor(dynamodbConfig) {
        super();
    }

    public set(key: string, data) {
    }

    public bulkdSet(values: {
        key: string,
        data: any
    }[]) {
    }

    public setField(key: string, field, data) {
    }

    public get(key: string) {
    }

    public getField(key: string, field: string) {
    }

    public bulkGet(keys: string[]) {
    }

    public delete(key: string) {
    }

    public bulkDelete(keys: string) {
    }
}