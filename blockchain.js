const cluster = require('cluster')
const dgram = require('dgram')
const express = require('express')


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
    this.blocks = []
    this.peers = {}

    // Peer discovery server
    this.peerServer = dgram.createSocket('udp4')
    this.peerServer.on('listening', this.onPeerServerListening.bind(this))
    this.peerServer.on('message', this.onPeerMessage.bind(this))

    // RPC server
    this.httpServer = express()
    // TODO: API to show know peers
    // this.httpServer.get('/peers', this.showPeers.bind(this))
    // TODO: API to show current blocks
    // this.httpServer.get('/blocks', this.showBlocks.bind(this))
  }

  start() {
    if (!cluster.isMaster) return

    // Start peer discovery server
    cluster.fork().on('online', _ => this.peerServer.bind(2346))

    // Start RPC server
    cluster.fork().on('online', _ => this.httpServer.listen(2345, _ => {
      console.info(`RPC server started at 2345.`)
    }))
  }

  onPeerServerListening() {
    const address = this.peerServer.address()
    console.info(
      `Peer discovery server started at ${address.address}:${address.port}.`
    )

    const message = Buffer.from('hello')
    // TODO: broadcast 'hello' message to subnet '172.28.0.0'
  }

  onPeerMessage(message, remote) {
    // TODO: Check if the message is 'hello'

    // TODO: Add the peer's address to `this.peers`, if it's not there already
    console.log(`Peer discovered: ${remote.address}:${remote.port}`)

    const reply = Buffer.from('hello')
    // TODO: Reply to the peer with the same 'hello' message
  }
}


exports.Block = Block
exports.Server = Server
