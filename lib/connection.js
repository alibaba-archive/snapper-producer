'use strict';

var net = require('net');
var util = require('util');
var jsonrpc = require('jsonrpc-lite');

var TIMEOUT = 60 * 1000;
var rpcId = 0;

module.exports = Connection;

function Connection(port, host, client) {
  this.client = client;
  this.port = port;
  this.host = host;

  this.ended = false;
  this.connected = false;

  this.attempts = 0;
  this.retryDelay = 1000;
  this.messagesHighWater = 20;
  this.rpcHighWater = 100;
  this.maxAttempts = 20;

  this.rpcCount = 0;
  this.messagesCount = 0;
  this.pendingRpcCout = 0;

  this.queue = [];
  this.pendingRpc = Object.create(null);

  this.connect();
}

Connection.prototype.send = function(params) {
  var ctx = this;
  this.messagesCount++;
  this.queue.push(params);
  this.execQueue();
};

Connection.prototype.sendRPC = function(method, params, callback) {
  var ctx = this;
  var id = ++rpcId;
  this.rpcCount++;
  var msgObj = jsonrpc.request(id, method, params);
  var timer = null;

  callback = callback || noOp;
  ctx.pendingRpc[id] = {
    data: JSON.stringify(msgObj),
    callback: function(err, res) {
      delete ctx.pendingRpc[id];
      this.pendingRpcCout--;
      clearTimeout(timer);
      callback(err, res);
      if (err == null) ctx.execQueue();
    }
  };

  timer = setTimeout(function() {
    ctx.pendingRpc[id].callback(new Error(`Send RPC time out, ${id}`));
  }, TIMEOUT);

  this.pendingRpcCout++;
  return this.socket.write(this.pendingRpc[id].data);
};

Connection.prototype.execQueue = function() {
  if (!this.connected || this.pendingRpcCout > this.rpcHighWater) return false;
  var flushed = true;
  while (flushed && this.queue.length) {
    flushed = this.sendRPC('publish', this.queue.splice(0, this.messagesHighWater));
  }
  return true;
};

Connection.prototype.resendPending = function() {
  var ctx = this;
  Object.keys(this.pendingRpc).sort().forEach(function(id) {
    ctx.socket.write(ctx.pendingRpc[id].data);
  });
};

Connection.prototype.destroy = function() {
  if (this.ended) return;
  this.connected = false;
  this.socket.removeAllListeners(['connect', 'data', 'error', 'close']);
  this.socket.end();
  this.socket.destroy();
  this.socket = null;
};

Connection.prototype.auth = function() {
  var ctx = this;
  var token = this.client.signAuth({producerId: this.client.producerId});

  this.sendRPC('auth', [token], function(err, res) {
    if (res !== 'OK') return ctx.emit('error', err || new Error(res));
    ctx.connected = true;
    ctx.client.emit('connect');
    ctx.resendPending();
    ctx.execQueue();
  });
};

Connection.prototype.connect = function() {
  var ctx = this;

  this.connected = false;
  if (this.socket) this.destroy();

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
      // auto auth
      ctx.auth();
    })
    .on('data', function(chunk) {
      chunk = chunk.toString();
      var res = jsonrpc.parse(chunk);
      if (res.type === 'invalid')
        return ctx.client.emit('error', new Error('Parse error: ' + chunk));

      if (res.type !== 'success' && res.type !== 'error')
        return ctx.client.emit('error', new Error('Unhandle chunk: ' + chunk));

      var rpc = ctx.pendingRpc[res.payload.id];
      if (!rpc) return ctx.client.emit('warn', new Error('Unhandle RPC: ' + chunk));

      if (res.type === 'error') rpc.callback(res.payload.error);
      else rpc.callback(null, res.payload.result);
    })
    .on('error', function(error) {
      ctx.client.emit('error', error);
    })
    .on('close', function() {
      ctx.reconnecting();
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
