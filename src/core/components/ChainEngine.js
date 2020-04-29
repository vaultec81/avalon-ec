class Block {
    constructor(index, phash, timestamp, txs, miner, missedBy, dist, burn, signature, hash) {
        this._id = index
        this.phash = phash.toString()
        this.timestamp = timestamp
        this.txs = txs
        this.miner = miner
        if (missedBy) this.missedBy = missedBy
        if (dist) this.dist = dist
        if (burn) this.burn = burn
        this.hash = hash
        this.signature = signature
    }
}
class ChainEngine {
    constructor(self) {
        this.self = self;
        this.recentBlocks = []
    }
    async start() {
        var genesis = await this.self.db.collection("blocks").findOne({ _id: 0 })
        if (genesis) {
            if (genesis.hash !== this.self.config.get("chain.originHash")) {
                this.self.logr.fatal('Block #0 hash doesn\'t match config. Did you forget to db.dropDatabase() ?')
                process.exit(1)
            }
        } else {
            logr.info('Creating Genesis Block #0 with hash ' + config.originHash)
            db.collection('accounts').insertOne({
                name: this.self.config.get("chain.masterName"),
                pub: this.self.config.get("chain.masterPub"),
                balance: this.self.config.get("chain.masterBalance"),
                bw: { v: 0, t: this.self.config.get("chain.block0ts") },
                vt: { v: 0, t: this.self.config.get("chain.block0ts") },
                pr: { v: 0, t: this.self.config.get("chain.block0ts") },
                uv: 0,
                // we set those arbitrarily
                approves: [this.self.config.get("chain.masterName")],
                node_appr: this.self.config.get("chain.masterBalance"),
                follows: [],
                followers: [],
                keys: []
            })
            await this.self.db.collection("blocks").insertOne(this.getGenesisBlock())
        }
        await this.loadBlocksIntoMemory();
    }
    async loadBlocksIntoMemory() {
        var blocks = await this.self.db.collection('blocks').find({}, {
            sort: {_id: -1}
            //limit: config.ecoBlocksIncreasesSoon ? config.ecoBlocksIncreasesSoon : config.ecoBlocks
        }).toArray()
        this.recentBlocks = blocks.reverse()
    }
    getLatestBlock() {
        return this.recentBlocks[this.recentBlocks.length - 1]
    }
    getGenesisBlock() {
        return new Block(
            0,
            '0',
            0,
            [],
            this.self.config.get("chain.masterName"),
            null,
            null,
            null,
            '0000000000000000000000000000000000000000000000000000000000000000',
            this.self.config.get("chain.originHash")
        )
    }
    prepareBlock() {
        var previousBlock = this.getLatestBlock()
        var nextIndex = previousBlock._id + 1
        var nextTimestamp = new Date().getTime()
        // grab all transactions and sort by ts
        var txs = transaction.pool.sort(function (a, b) { return a.ts - b.ts })
        var miner = process.env.NODE_OWNER
        return new Block(nextIndex, previousBlock.hash, nextTimestamp, txs, miner)
    }
    hashAndSignBlock(block) {
        var nextHash = this.calculateHash(block._id, block.phash, block.timestamp, block.txs, block.miner, block.missedBy, block.distributed, block.burned)
        var signature = secp256k1.sign(Buffer.from(nextHash, 'hex'), bs58.decode(process.env.NODE_OWNER_PRIV))
        signature = bs58.encode(signature.signature)
        return new Block(block._id, block.phash, block.timestamp, block.txs, block.miner, block.missedBy, block.distributed, block.burned, signature, nextHash)
    }
}
module.exports = ChainEngine;