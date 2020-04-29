class p2p {
    constructor(self) {
        this.self = self;
        this.legacy = new (require('./legacy'))(self)
    }
    async start() {
        this.legacy.connect(this.self.config.get("p2p.peers"))
    }
}
module.exports = p2p;