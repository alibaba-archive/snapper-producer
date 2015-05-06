'use strict';

var net = require('net');
var util = require('util');
var Bufsp = require('bufsp');
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

  this.authId = 0;
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

  callback = callback;
  ctx.pendingRpc[id] = {
    pending: true,
    method: method,
    data: this.bufsp.encode(JSON.stringify(msgObj)),
    callback: function(err, res, rpc) {
      delete ctx.pendingRpc[id];
      this.pendingRpcCout--;
      clearTimeout(timer);
      if (callback) callback(err, res);
      else if (err) ctx.client.emit('error', err);
      else if (rpc) ctx.client.emit('jsonrpc', rpc);
    }
  };

  timer = setTimeout(function() {
    ctx.pendingRpc[id].callback(new Error(`Send RPC time out, ${id}`));
  }, TIMEOUT);

  this.pendingRpcCout++;
  if (this.ended) return ctx.pendingRpc[id].callback(new Error('Client have been closed!'));
  if (this.connected) this.socket.write(this.pendingRpc[id].data);
  else this.pendingRpc[id].pending = false;
  return id;
};

Connection.prototype.execQueue = function() {
  if (this.pendingRpcCout > this.rpcHighWater) return false;
  while (this.queue.length) this.sendRPC('publish', this.queue.splice(0, this.messagesHighWater));
  return true;
};

Connection.prototype.resendRPC = function() {
  var ctx = this;
  var queue = Object.keys(this.pendingRpc).sort(function(a, b) {
    return +a - b;
  });

  queue.forEach(function(id) {
    if (ctx.pendingRpc[id].pending) return;
    ctx.pendingRpc[id].pending = true;
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

  return this.sendRPC('auth', [token], function(err, res) {
    if (!res || !res.id) {
      ctx.client.emit('error', err || new Error(JSON.stringify(res)));
      return ctx.client.close();
    }
    ctx.socket.id = res.id;
    ctx.connected = true;
    ctx.client.emit('connect');
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

  this.bufsp = new Bufsp({
    encoding: 'utf8',
    returnString: true
  });

  this.bufsp
    .on('data', function(message) {
      if (message == null) return;
      if (message instanceof Error)
        return ctx.client.emit('error', message);

      var res = jsonrpc.parse(message);
      if (res.type === 'invalid')
        return ctx.client.emit('error', new Error('Parse error: ' + message));

      if (res.type !== 'success' && res.type !== 'error')
        return ctx.client.emit('error', new Error('Unhandle chunk: ' + message));

      var rpc = ctx.pendingRpc[res.payload.id];
      if (!rpc) return ctx.client.emit('warn', new Error('Unhandle RPC: ' + message));

      if (res.type === 'error') rpc.callback(res.payload.error);
      else rpc.callback(null, res.payload.result, res.payload);
    })
    .on('drain', function() {
      ctx.execQueue();
    })
    .on('error', function(error) {
      ctx.client.emit('error', error);
    });

  socket
    .on('connect', function() {
      // reset
      ctx.attempts = 0;
      ctx.retryDelay = 1000;
      ctx.resendRPC();
    })
    .on('error', function(error) {
      ctx.client.emit('error', error);
      ctx.connect();
    })
    .on('close', function() {
      if (!ctx.ended) ctx.reconnecting();
    });

  socket.pipe(this.bufsp);
  // auto auth
  if (this.authId) delete this.pendingRpc[this.authId];
  this.authId = this.auth();
  return this;
};

Connection.prototype.reconnecting = function() {
  var ctx = this;
  this.connected = false;
  if (this.ended) return;

  //reset pendingRpc
  for (var id in this.pendingRpc) this.pendingRpc[id].pending = false;

  if (++this.attempts <= this.maxAttempts) {
    this.retryDelay *= 1.2;
    if (this.retryDelay > 5000) this.retryDelay = 5000;

    setTimeout(function() {
      ctx.connect();
      ctx.resendRPC();
      ctx.client.emit('reconnecting', {
        delay: ctx.retryDelay,
        attempts: ctx.attempts
      });
    }, this.retryDelay);
  } else {
    this.destroy();
  }
};
