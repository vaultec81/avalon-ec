const Components = require('./components')
const Utils = require('./utils')
const mergeOptions = require('merge-options')
const MongoClient = require('mongodb').MongoClient;

/**
 * Main application entry point.
 */
class Core {
    constructor(options) {
        const defaults = {
            path: Utils.repoPath()
        };
        this._options = mergeOptions(defaults, options);
        this.config = new Components.Config(Utils.datastore(this._options.path))
        this.logr = Components.logger(this._options.path)
        this.p2p = new Components.p2p(this)
        this.chainEngine = new Components.ChainEngine(this)
        this.transaction = new Components.TransactionPool(this)
    }
    async start() {
        await this.config.open();
        var databaseInfo = this.config.get("Database")
        var url = `mongodb://${databaseInfo.user}:${databaseInfo.password}@${databaseInfo.host}?authMechanism=DEFAULT&authSource=${databaseInfo.database}`;
        var client = await MongoClient.connect(url);
        this.db = client.db(databaseInfo.database);
        await this.chainEngine.start()
        await this.p2p.start();
    }
    async stop() {
        this.config.save()
    }
}
module.exports = Core;