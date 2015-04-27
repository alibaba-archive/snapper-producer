'use strict';

var net = require('net');
var util = require('util');
var jsonrpc = require('jsonrpc-lite');

var tool = require('./tool');
var Queue = require('./queue');

var Thunk = require('thunks')();
var TIMEOUT = 60 * 1000;
var rpcId = 0;

exports.Connection = Connection;

function Connection(port, host, client) {
  this.client = client;

  this.attempts = 0;
  this.retryDelay = 1000;
  this.port = port;
  this.host = host;
  this.ended = false;
  this.connected = false;
  this.pendingWatcher = null;
  this.messagesHighWater = 20;
  this.rpcHighWater = 100;
  this.messagesCount = 0;
  this.rpcCount = 0;
  this.pendingRpcCout = 0;
  this.waitTimer = null;
  this.maxAttempts = 10;

  this.queue = [];
  this.pendingRpc = Object.create(null);

  this.connect();
}

Connection.prototype.send = function(params) {
  var ctx = this;
  this.queue.push(params);
  this.execQueue();
};

Connection.prototype.sendRPC = function(method, params, callback) {
  var ctx = this;
  var id = ++rpcId;
  var msgObj = jsonrpc.request(id, method, params);
  var timer = null;

  callback = callback || noOp;
  ctx.pendingRpc[id] = {
    rpc: JSON.sringify(msgObj),
    callback: function(err, res) {
      delete ctx.pendingRpc[id];
      this.pendingRpcCout--;
      clearTimeout(timer);
      callback(err, res);
      ctx.execQueue();
    }
  };

  timer = setTimeout(function() {
    ctx.pendingRpc[id](new Error(`Send RPC time out, ${id}`));
  }, TIMEOUT);

  this.pendingRpcCout++;
  return this.socket.write(this.pendingRpc[id].rpc);
};

Connection.prototype.execQueue = function() {
  if (!this.connected || this.pendingRpcCout > this.rpcHighWater || !this.queue.length) return false;
  var flushed = true;
  while (flushed) {
    flushed = this.sendRPC('publish', this.queue.splice(0, this.messagesHighWater));
  }
  return true;
};

Connection.prototype.rescuePending = function() {
  var ctx = this;
  Object.keys(this.pendingRpc).sort().forEach(function(id) {
    ctx.socket.write(ctx.pendingRpc[id].rpc);
  });
};

Connection.prototype.destroy = function() {
  if (this.ended) return;
  this.ended = true;
  this.connected = false;
  this.socket.end();
  this.socket.destroy();
  this.socket = null;
};

Connection.prototype.connect = function() {
  var ctx = this;

  this.connected = false;
  if (this.socket) this.socket.destroy();

  var socket = this.socket = net.createConnection({
    host: this.host,
    port: this.port
  });

  socket.setTimeout(0);
  socket.setNoDelay(true);
  socket.setKeepAlive(true);

  socket
    .on('connect', function() {
      // reset
      ctx.attempts = 0;
      ctx.retryDelay = 1000;
    })
    .on('data', function(chunk) {

    })
    .on('error', function(error) {
      ctx.client.emit('error', error);
    })
    .on('close', function(hadError) {
      ctx.reconnecting();
    })
    .on('timeout', function() {
      ctx.reconnecting();
    })
    .on('end', function() {
      ctx.client.emit('end');
    });
  return this;
};

Connection.prototype.reconnecting = function() {
  var ctx = this;
  this.connected = false;
  if (this.ended) return;

  if (++this.attempts <= this.maxAttempts) {
    this.retryDelay *= 1.2;
    if (this.retryDelay > 5000) this.retryDelay = 5000;

    setTimeout(function() {
      ctx.connect();
      ctx.client.emit('reconnecting', {
        delay: ctx.retryDelay,
        attempts: ctx.attempts
      });
    }, this.retryDelay);
  } else {
    this.destroy();
  }
};

function noOp(err) {
  if (err !== null) console.log(err);
}
