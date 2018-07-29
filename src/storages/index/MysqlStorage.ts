const Sequelize = require('sequelize');

import {IndexStorage} from "./IndexStorage";
import {MysqlConfig} from '../../index.d';

export class MysqlStorage extends IndexStorage {
    private connection;
    private Workflows;

    public constructor(config: MysqlConfig) {
        super();
        let port = config.port || 3306;
        let database = config.database || 'jobs';
        this.connection = new Sequelize(
            database, // Database name
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
            createdAt: Sequelize.DATE,
            updatedAt: Sequelize.DATE,
        }, {
            tableName: 'workflows',
        });

        this.connection.sync();
    }

    public getAll() {
        return this.Workflows.findAll();
    }

    public create(workflow) {
        return this.Workflows.create(workflow);
    }
}