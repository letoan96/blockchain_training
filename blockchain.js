const crypto = require('crypto')


class Block {
  constructor(index, previousHash, timestamp, data, nonce) {
    this.index = index
    this.previousHash = previousHash
    this.timestamp = timestamp
    this.nonce = nonce
    this.hash = null
  }
}


class Server {
  constructor() {

  }

  start(genesis=null) {
    console.log('Node started.')

    if (!genesis) {
      // TODO: broadcast ourself, waiting for data from peer
    }
  }
}


exports.Block = Block
exports.Server = Server
