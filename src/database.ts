const Sequelize = require('sequelize');

import { MysqlConfig } from './index.d';

export class Database
{
    private connection;
    private Workflows;

    public constructor(config : MysqlConfig)
    {
        let port = config.port || 3306;
        this.connection = new Sequelize(
            'jobs', // Database name
            config.username,
            config.password,
            {
                dialect: 'mysql',
                host: config.host,
                port,
                logging: false,
            },
        );

        this.Workflows = this.connection.define('workflows', {
            id: {
                type: Sequelize.STRING,
                limit: 50,
                primaryKey: true,
            },
            name: {
                type: Sequelize.STRING,
                limit: 250
            },
            generator: {
                type: Sequelize.STRING,
                limit: 50
            },
            createdAt: Sequelize.DATE,
            updatedAt: Sequelize.DATE,
        }, {
            tableName: 'workflows',
        });

        this.connection.sync();
    }
}