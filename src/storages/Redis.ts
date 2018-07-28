const RedisClass = require('Redis');
const Promise = require('bluebird');
Promise.promisifyAll(RedisClass.RedisClient.prototype);
Promise.promisifyAll(RedisClass.Multi.prototype);

/**
 * Interface to the redis client.
 * JSON stringify/parse all values.
 *
 * Also promisify all functions.
 */
export class Redis extends Storage {
    private redis = null;

    public constructor(redisConfig) {
        super();
        redisConfig = Object.assign({}, {
            port: 6379,
        }, redisConfig);
        this.redis = RedisClass.createClient(redisConfig);
        this.redis.on('error', function (err) {
            console.log('[REDIS ERROR] ' + err);
        });
    }

    public set(key: string, data) {
        return this.redis.hmsetAsync(key, this.redify(data));
    }

    public bulkdSet(values: {
        key: string,
        data: any
    }[])
    {
        let query = this.redis.multi();
        for (let value of values) {
            query.hmset(value.key, this.redify(value.data));
        }
        return query.execAsync();
    }

    public setField(key: string, field, data) {
        return this.redis.hsetAsync(key, JSON.stringify(data));
    }

    public get(key: string) {
        let self = this;
        return this.redis.hgetallAsync(key)
            .then(hash => {
                return self.parse(hash);
            });
    }

    public getField(key: string, field: string) {
        return this.redis.hgetAsync(key, field)
            .then(value => {
                if (value == null) return null
                else return JSON.parse(value);
            })
    }

    public bulkGet(keys: string[]) {
        let self = this;
        let query = this.redis.multi();
        for (let key of keys) {
            query.hgetall(key);
        }

        return new Promise((resolve, reject) => {
            query.exec(function (err, replies) {
                if (err) {
                    reject(err);
                } else {
                    resolve(replies.map(self.parse))
                }
            } as any)
        });
    }

    public delete(key: string) {
        return this.redis.delAsync(key);
    }

    public bulkDelete(keys: string) {

        let query = this.redis.multi();
        for (let key of keys) {
            query.del(key);
        }
        return query.execAsync();
    }

    /********************************************************
     * Commons
     *******************************************************/

    /**
     * Jsonify all values of the given object.
     */
    private redify(obj) {
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
    private parse(obj) {
        let newObj = {};
        for (let key in obj) {
            let value = obj[key];
            newObj[key] = value == 'undefined' ? null : JSON.parse(obj[key]);
        }
        return newObj;
    }
}
