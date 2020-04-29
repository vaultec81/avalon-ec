var WebSocket = require('ws')
var secp256k1 = require('secp256k1')
var bs58 = require('base-x')("123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz")
var CryptoJS = require('crypto-js')

var MessageType = {
    QUERY_NODE_STATUS: 0,
    NODE_STATUS: 1,
    QUERY_BLOCK: 2,
    BLOCK: 3,
    NEW_BLOCK: 4,
    NEW_TX: 5,
    BLOCK_CONF_ROUND: 6
}
var logr;
class Legacy {
    constructor(self) {
        this.self = self;
        this.sockets = [];
        this.recoveringBlocks = [];
        this.recoveredBlocks = [];
        this.recovering = [];
        logr = this.self.logr
    }
    connect(newPeers) {
        newPeers.forEach((peer) => {
            var ws = new WebSocket(peer)
            ws.on('open', () => this.handshake(ws))
            ws.on('error', () => {
                logr.warn('peer connection failed', peer)
            })
        })
    }
    handshake(ws) {
        if (process.env.OFFLINE) {
            logr.warn('Incoming handshake refused because OFFLINE')
            ws.close(); return
        }
        if (process.env.NO_DISCOVERY && p2p.sockets.length >= process.env.PEERS.split(',').length) {
            logr.warn('Incoming handshake refused because in NO_DISCOVERY mode and already peered enough')
            ws.close(); return
        }
        // close connection if we already have this peer ip in our connected sockets
        for (let i = 0; i < this.sockets.length; i++)
            if (this.sockets[i]._socket.remoteAddress === ws._socket.remoteAddress
                && this.sockets[i]._socket.remotePort === ws._socket.remotePort) {
                ws.close()
                return
            }
        logr.debug('Handshaking new peer', ws.url || ws._socket.remoteAddress + ':' + ws._socket.remotePort)
        this.sockets.push(ws)
        this.messageHandler(ws)
        //p2p.errorHandler(ws)
        this.sendJSON(ws, { t: MessageType.QUERY_NODE_STATUS })
    }
    messageHandler(ws) {
        ws.on('message', async (data) => {
            //var user = p2p.sockets[p2p.sockets.indexOf(ws)].node_status ? p2p.sockets[p2p.sockets.indexOf(ws)].node_status.owner : 'unknown'
            //logr.trace('P2P-IN:', user, data)
            try {
                var message = JSON.parse(data)
            } catch (e) {
                logr.warn('Received non-JSON, doing nothing ;)')
            }
            if (!message || typeof message.t === 'undefined') return

            switch (message.t) {
                case MessageType.QUERY_NODE_STATUS:
                    var d = {
                        origin_block: this.self.config.get("chain.originHash"),
                        head_block: this.self.chainEngine.getLatestBlock()._id,
                        head_block_hash: this.self.chainEngine.getLatestBlock().hash,
                        previous_block_hash: this.self.chainEngine.getLatestBlock().phash,
                        owner: this.self.config.get("node.owner")
                    }
                    var signedMessage = this.hashAndSignMessage({ t: MessageType.NODE_STATUS, d: d })
                    this.sendJSON(ws, signedMessage)
                    break

                case MessageType.NODE_STATUS: {
                    if(await this.verifySignedMessage(message)) {
                        this.sockets[this.sockets.indexOf(ws)].node_status = message.d
                    } else {
                        this.self.logr.debug('Wrong p2p sign')
                    }
                    break

                }
                case MessageType.QUERY_BLOCK:
                    this.self.db.collection('blocks').findOne({ _id: message.d }, function (err, block) {
                        if (err)
                            throw err
                        if (block)
                            this.sendJSON(ws, { t: MessageType.BLOCK, d: block })
                    })
                    break

                case MessageType.BLOCK:
                    for (let i = 0; i < p2p.recoveringBlocks.length; i++)
                        if (this.recoveringBlocks[i] === message.d._id) {
                            this.recoveringBlocks.splice(i, 1)
                            break
                        }

                    if (chain.getLatestBlock()._id + 1 === message.d._id)
                        this.addRecursive(message.d)
                    else {
                        this.recoveredBlocks[message.d._id] = message.d
                        p2p.recover()
                    }
                    break

                case MessageType.NEW_BLOCK:
                    var socket = this.sockets[this.sockets.indexOf(ws)]
                    if (!socket || !socket.node_status) return
                    var block = message.d
                    consensus.round(0, block)
                    this.sockets[this.sockets.indexOf(ws)].node_status.head_block = block._id
                    this.sockets[this.sockets.indexOf(ws)].node_status.head_block_hash = block.hash
                    this.sockets[this.sockets.indexOf(ws)].node_status.previous_block_hash = block.phash
                    break
                case MessageType.NEW_TX:
                    var tx = message.d
                    this.self.transaction.isValid(tx, new Date().getTime(), function (isValid) {
                        if (isValid && !transaction.isInPool(tx)) {
                            transaction.addToPool([tx])
                            this.broadcast({ t: 5, d: tx })
                        }

                    })
                    break

                case MessageType.BLOCK_CONF_ROUND:
                    // we are receiving a consensus round confirmation
                    var leader = this.sockets[this.sockets.indexOf(ws)]
                    if (!leader || !leader.node_status) return

                    // always try to precommit in case its the first time we see it
                    consensus.round(0, message.d.b)

                    // process the message inside the consensus
                    consensus.messenger(leader, message.d.r, message.d.b)
                    break
            }
        })
    }
    closeConnection(ws) {
        this.sockets.splice(this.sockets.indexOf(ws), 1)
        logr.debug('a peer disconnected, ' + this.sockets.length + ' peers left')
    }
    sendJSON(ws, data) {
        try {
            var user = this.sockets[this.sockets.indexOf(ws)].node_status ? this.sockets[this.sockets.indexOf(ws)].node_status.owner : 'unknown'
            var data = JSON.stringify(data)
            //logr.trace('P2P-OUT:', user, data)
            ws.send(data)
        } catch (error) {
            logr.warn('Tried sending p2p message and failed')
        }
    }
    broadcast(d) {
        this.sockets.forEach(ws => this.sendJSON(ws, d))
    }
    broadcastBlock(block) {
        this.broadcast({ t: 4, d: block })
    }
    hashAndSignMessage(message) {
        var hash = CryptoJS.SHA256(JSON.stringify(message)).toString();
        var signature = secp256k1.sign(Buffer.from(hash, 'hex'), bs58.decode(this.self.config.get("node.owner_priv")));
        signature = bs58.encode(signature.signature)
        message.s = {
            n: this.self.config.get("node.owner"),
            s: signature
        }
        return message
    }
    async verifySignedMessage(message) {
        var sign = message.s.s
        var name = message.s.n
        var tmpMess = message
        delete tmpMess.s
        var hash = CryptoJS.SHA256(JSON.stringify(tmpMess)).toString()
        var account = await this.self.db.collection('accounts').findOne({ name: name })

        /*if (!account && replay_pub && secp256k1.verify(
            Buffer.from(hash, 'hex'),
            bs58.decode(sign),
            bs58.decode(replay_pub))) {
            return true;
        }*/
        if (account && secp256k1.verify(
            Buffer.from(hash, 'hex'),
            bs58.decode(sign),
            bs58.decode(account.pub))) {
            return account;
        }

    }
}
module.exports = Legacy;