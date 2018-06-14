const cluster = require('cluster')
const dgram = require('dgram')
const express = require('express')
const crypt = require('crypto-js')
const parser = require('body-parser')
const request = require('request');
const fs = require('fs');
const transaction = {
  "From": "Trung",
  "To": "Hieu",
  "Amount": 100
};


class Block {
  constructor(index, previousHash, timestamp, data, hash, nonce) {
    this.index = index
    this.previousHash = previousHash.toString()
    this.timestamp = timestamp
    this.data = data
    this.hash = hash.toString()
    this.nonce = nonce;
  }
}

class Server {
  constructor() {
    this.maxIndex = 0;
    this.nodeWithLongestChain = '';
    this.blocks = []; //Genesis block
    this.peers = {}

    // Peer discovery server
    this.peerServer = dgram.createSocket('udp4')
    this.peerServer.on('listening', this.onPeerServerListening.bind(this))
    this.peerServer.on('message', this.onPeerMessage.bind(this));

    // RPC server
    this.httpServer = express();
    this.httpServer.use(parser.json());
    // TODO: API to show know peers
    //
    this.httpServer.get('/peers', this.showPeers.bind(this));
    this.httpServer.post('/maketransaction', this.handleTransaction.bind(this));


    //API to show current blockchain
    this.httpServer.get('/blocks', this.showBlockChain.bind(this));
  }

  showBlockChain(req, res) {
    res.send(this.blocks);
  }

  showPeers(req, res) {
    res.json(this.peers);
    console.log(JSON.stringify(this.peers));
  }

  updateStorage() {
    var content = JSON.stringify(this.blocks)
    fs.writeFile(__dirname + '/blockchain.txt', content, function (err) {})
  }

  async readStorage() {
    try {
      var blockfile = await this.readStorageFile();
      this.blocks = JSON.parse(blockfile);
    } catch (err) {
      this.blocks = [new Block(0, '0', new Date(), '', "816534932c2b7154836da6afc367695e6337db8a921823784c14378abed4f7d7", 0)] // tạm  thời đặt đây. đặt vô asyn nó fail là nó sẽ set this.blocks = block genesis
    }
    return true;
  }

  readStorageFile() {
    return new Promise(function (resolve, reject) {
      fs.readFile(__dirname + '/blockchain.txt', function (err, data) {
        resolve(data);
        reject(err);
      })
    })
  }

  handleTransaction(req, res) {
    var txData = transaction;
    var newBlock = this.createBlock(txData);
    this.peerServer.setBroadcast(true);
    this.peerServer.send(Buffer.from(JSON.stringify({ message: "New Block", block: newBlock })),
      this.peerServer.address().port, '172.16.255.255', (err) => { })
    res.send('Mined successfully! Waiting for confirmed!')
  }

  getLatestBlock() { return this.blocks[this.blocks.length - 1]; }

  createBlock(blockData) {
    var latestBlock = this.getLatestBlock();
    var newIndex = latestBlock.index + 1;
    var newTimestamp = Date.now();
    var newBlock = this.mineNewBlock(latestBlock, newIndex, newTimestamp, blockData);
    return newBlock;
  }

  mineNewBlock(latestBlock, newIndex, newTimestamp, blockData) {
    var nonce = 0
    var newHash = ''
    while (true) {
      newHash = this.calculateHash(newIndex, latestBlock.hash, newTimestamp, blockData, nonce);
      if (newHash.substring(0, 2) !== '00') {
        nonce += 1;
      } else { return new Block(newIndex, latestBlock.hash, newTimestamp, blockData, newHash, nonce) }
    }
  }

  calculateHash(index, previousHash, timestamp, data, nonce) {
    return crypt.SHA256(index + previousHash + timestamp + data + nonce).toString()
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
    console.log(this.peerServer.address());
    console.info(
      `Peer discovery server started at ${address.address}:${address.port}.`
    )
    this.readStorage();
    const message = Buffer.from('hello')
    this.peerServer.setBroadcast(true);
    this.peerServer.send(message, 2346, '172.16.255.255', (err) => { })
    console.log("Start");
    // TODO: broadcast 'hello' message to subnet '172.16.0.0'
  }

  validateBlock(newBlock, latestBlock, remote) {
    if (newBlock.index !== latestBlock.index + 1) {
      if (newBlock.index > latestBlock.index + 1){
        this.peerServer.send(Buffer.from('requestLongestChain'), this.peerServer.address().port, remote.address, (err) => { }); 
      }else{
      console.log(newBlock);
      console.log('old block!');
      return false;
      }
    }
    else if (newBlock.previousHash !== latestBlock.hash) {
      console.log('Error previous hash!');
      return false;
    }
    else if (this.calculateHash(newBlock.index, newBlock.previousHash, newBlock.timestamp, newBlock.data, newBlock.nonce) !== newBlock.hash) {
      console.log('Error new hash!');
      return false;
    }
    return true;

  }

  onPeerMessage(message, remote) {
    // TODO: Check if the message is 'hello'  
    const reply = Buffer.from(JSON.stringify({
          maxIndex: this.blocks.length - 1
        }))  
    if (message.toString().includes('hello')) {
          console.log ('received message');

      // // TODO: Add the peer's address to `this.peers`, if it's not there already

      // if (!this.peers.hasOwnProperty(`${remote.address}`)) {
      //   console.log(`$$$$$$$$$Peer discovered: ${remote.address}:${remote.port}$$$$$` );
      //   this.peers[`${remote.address}`] = remote.port ;
        
      //   const message = Buffer.from('hello')
      //   // TODO: Reply to the peer with the same 'hello' message
      //   this.peerServer.send(message, this.peerServer.address().port, remote.address, (err) => { });
        this.peerServer.send(reply, 2346, remote.address, (err) => { });         
      
      }
      
    
    //Check the broadcast message when some node mined a block successfully and confirm it
    if (message.toString().includes('New Block')) {
      var newBlock = JSON.parse(message.toString()).block;
      var latestBlock = this.blocks[this.blocks.length - 1];
      if (this.validateBlock(newBlock, latestBlock, remote)) {
        this.blocks.push(newBlock);
        this.updateStorage();
        console.log('Block ' + newBlock.index + ' is confirmed!');
      }
      else {
        console.log('Block ' + newBlock.index + ' is not confirmed !');
      }
    }

    if (message.toString().includes('maxIndex')) {
      var receivedMaxIndex = JSON.parse(message.toString()).maxIndex;
      if (receivedMaxIndex > this.maxIndex && receivedMaxIndex > 0 ) {
        this.maxIndex = receivedMaxIndex;
        this.nodeWithLogestChain = remote.address;
        this.peerServer.send(Buffer.from('requestLongestChain'), this.peerServer.address().port, remote.address, (err) => { });       
      }
    }

    if (message.toString() === 'requestLongestChain') {
      this.peerServer.send(Buffer.from(
        JSON.stringify({
          message: 'getLongestChain',
          chain: this.blocks
        })), this.peerServer.address().port, remote.address, (err) => { })
    }

    if (message.toString().includes('getLongestChain')) {          
      this.blocks = JSON.parse(message.toString()).chain;
      this.updateStorage();
      console.log(`$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$Got new longestChain from ${remote.address}$$$$$ then updated` );
    }
  }
}

exports.Block = Block
exports.Server = Server