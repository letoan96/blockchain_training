const cluster = require('cluster')
const dgram = require('dgram')
const crypto = require('crypto')
const assert = require('assert')

const express = require('express')
const parser = require('body-parser')
const request = require('request')

const lastOf = list => list[list.length - 1]


class Block {

  constructor(index, previousHash, timestamp, data, nonce=0, hash='') {
    this.index = index
    this.previousHash = previousHash
    this.timestamp = timestamp
    this.data = data
    this.nonce = nonce
    this.hash = hash
  }

  calculateHash() {
    const { hash, ...data } = this
    return crypto
      .createHmac('sha256', JSON.stringify(data))
      .digest('hex')
  }

  static get GENESIS() {
    return new Block(
      0, '', 1522983367254, null, 0,
      'e063dac549f070b523b0cb724efb1d4f81de67ea790f78419f9527aa3450f64c'
    )
  }

  static fromPrevious({ index, hash }, data) {
    // Initialize next block using previous block and transaction data
    // assert(typeof hash === 'string' && hash.length === 64)
    return new Block(index + 1, hash, Date.now(), data, 0)
  }

  static fromJson({ index, previousHash, timestamp, data, nonce, hash }) {
    const block = new Block(index, previousHash, timestamp, data, nonce, hash)
    assert(block.calculateHash() === block.hash)
    return block
  }
}


class Server {

  constructor() {
    this.blocks = [Block.GENESIS]
    this.peers = {}

    this.peerServer = dgram.createSocket('udp4')
    this.peerServer.on('listening', this.onPeerServerListening.bind(this))
    this.peerServer.on('message', this.onPeerMessage.bind(this))

    this.httpServer = express()
    this.httpServer.use(parser.json())
    this.httpServer.get('/peers', this.showPeers.bind(this))
    this.httpServer.get('/blocks', this.showBlocks.bind(this))
    this.httpServer.post('/blocks', this.processBlocks.bind(this))
    this.httpServer.post('/transactions', this.processTransaction.bind(this))
  }

  start() {
    if (!cluster.isMaster) return
    cluster.fork().on('online', _ => this.peerServer.bind(2346))
    cluster.fork().on('online', _ => this.httpServer.listen(2345, _ => {
      console.info('RPC server started at port 2345.')
    }))
  }

  onPeerServerListening() {
    const address = this.peerServer.address()
    console.info(
      `Peer discovery server started at ${address.address}:${address.port}.`
    )

    const message = Buffer.from('hello')
    this.peerServer.setBroadcast(true)
    this.peerServer.send(message, 0, message.length, address.port, '172.28.0.0')
  }

  onPeerMessage(message, remote) {
    if (this.peers[remote.address] || message.toString() !== 'hello') return

    this.peers[remote.address] = remote
    console.log(`Peer discovered: ${remote.address}:${remote.port}`)

    const reply = Buffer.from('hello')
    this.peerServer.send(reply, 0, reply.length, remote.port, remote.address)

    // Send them our blocks, hack to avoid waiting RPC server to start
    const ip = remote.address
    setTimeout(_ => {
      request.post(`http://${ip}:2345/blocks`, { json: this.blocks })
        .on('error', err => delete this.peers[ip])
    }, 400)
  }

  showPeers(req, resp) { resp.json(this.peers) }
  showBlocks(req, resp) { resp.json(this.blocks) }

  processTransaction(req, resp) {
    // FIXME: Assume transaction data is valid
    const block = Block.fromPrevious(lastOf(this.blocks), req.body)

    // Mining
    while (!block.hash.startsWith('00')) {
      block.nonce += 1
      block.hash = block.calculateHash()
    }

    this.blocks.push(block)

    console.info('New block mined: ', block)

    Object.keys(this.peers).forEach(ip => {
      request.post(`http://${ip}:2345/blocks`, { json: [block] })
        .on('error', err => delete this.peers[ip])
    })

    resp.json(block)
  }

  processBlocks(req, resp) {
    if (!req.body instanceof Array) {
      resp.status(400).json({ error: 'Invalid request' })
      return
    }

    const blocks = req.body.map(Block.fromJson)
    // console.info('Receiving new blocks: ', blocks)

    if (blocks.length === 1 && blocks[0].index === 0) return // genesis chain
    if (lastOf(blocks).index === lastOf(this.blocks).index) return // equal chain
    if (blocks[0].index > this.blocks.length) return  // chain with gap

    if (lastOf(blocks).index < lastOf(this.blocks).index) {
      console.warn('Receiving shorter chain, send them ours.')
      const ip = req.connection.remoteAddress
      request.post(`http://${ip}:2345/blocks`, { json: this.blocks })
        .on('error', err => delete this.peers[ip])
      return
    }

    const first = blocks[0].index > 0 ? blocks[0] : blocks[1]
    if (first.previousHash !== this.blocks[first.index - 1].hash) {
      console.error('Reciving invalid chain, ignoring')
      return
    }

    // TODO: Walk and verify the receving chain

    // Append new chain
    blocks.forEach(block => this.blocks[block.index] = block)
    console.log(this.blocks)

    resp.json({ ok: true })
  }
}


exports.Block = Block
exports.Server = Server