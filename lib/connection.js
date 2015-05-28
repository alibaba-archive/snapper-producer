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
  this.retryDelay = 3000;
  this.messagesHighWater = 20;
  this.rpcHighWater = 100;
  this.maxAttempts = 50;

  this.authId = 0;
  this.rpcCount = 0;
  this.messagesCount = 0;
  this.pendingRpcCount = 0;

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

Connection.prototype.sendRPC = function(method, params, callback, force) {
  var ctx = this;

  this.rpcCount++;
  var command = new RpcCommand(this, method, params, callback);

  if (this.ended) return command.callback(new Error('Client have been closed!'));
  if (this.connected || force) {
    command.pending = true;
    this.socket.write(command.data);
  }
  return command;
};

Connection.prototype.execQueue = function() {
  if (this.pendingRpcCount > this.rpcHighWater) return false;
  while (this.queue.length) this.sendRPC('publish', this.queue.splice(0, this.messagesHighWater));
  return true;
};

Connection.prototype.resendRPC = function() {
  var ctx = this;
  var pendingRpc = this.pendingRpc;

  Object.keys(pendingRpc)
    .sort(function(a, b) {
      return +a - b;
    })
    .forEach(function(id) {
      if (pendingRpc[id].pending) return;
      pendingRpc[id].pending = true;
      ctx.socket.write(pendingRpc[id].data);
    });
};

Connection.prototype.destroy = function() {
  if (this.ended || !this.socket) return;
  this.connected = false;
  this.socket.unpipe(this.bufsp);
  this.socket.removeAllListeners(['connect', 'data', 'error', 'close']);
  this.socket.end();
  this.socket = null;
};

Connection.prototype.auth = function() {
  var ctx = this;
  var token = this.client.signAuth({producerId: this.client.producerId});
  if (this.authCommand) this.authCommand.clear();

  this.authCommand = this.sendRPC('auth', [token], function(err, res) {
    ctx.authCommand = null;
    if (!res || !res.id) {
      ctx.client.emit('error', err || new Error(JSON.stringify(res)));
      return ctx.client.close();
    }
    ctx.socket.id = res.id;
    ctx.connected = true;
    ctx.client.emit('connect');
    ctx.execQueue();
  }, true);
  return this;
};

Connection.prototype.connect = function() {
  var ctx = this;

  this.connected = false;
  if (this.socket) this.destroy();

  this.socket = net.createConnection({
    host: this.host,
    port: this.port
  });

  this.socket.setTimeout(0);
  this.socket.setNoDelay(true);
  this.socket.setKeepAlive(true);

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

      if (res.type === 'success') return rpc.callback(null, res.payload.result, res.payload);
      // 正常连接后又认证失败（如服务器端重启了），则重新发起连接认证
      if (ctx.connected && res.payload.error.code === 400) ctx.connect();
      else rpc.callback(res.payload.error);
    })
    .on('drain', function() {
      ctx.execQueue();
    })
    .on('error', function(error) {
      ctx.client.emit('error', error);
    });

  this.socket
    .on('connect', function() {
      // reset
      ctx.attempts = 0;
      ctx.retryDelay = 3000;
      ctx.resendRPC();
    })
    .on('error', function(error) {
      ctx.client.emit('error', error);
    })
    .on('close', function() {
      if (!ctx.ended) ctx.reconnecting();
    });

  this.socket.pipe(this.bufsp);
  // auto auth
  this.auth();
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
    if (this.retryDelay > 10000) this.retryDelay = 10000;

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

function RpcCommand(connection, method, params, callback) {
  var ctx = this;

  this.id = ++rpcId;
  this.pending = false;
  this.method = method;
  this._callback = callback;
  this.connection = connection;

  var msgObj = jsonrpc.request(this.id, method, params);
  this.data = connection.bufsp.encode(JSON.stringify(msgObj));

  this.timer = setTimeout(function() {
    ctx.callback(new Error('Send RPC time out, ' + ctx.id + ', ' + ctx.method));
  }, TIMEOUT);
  connection.pendingRpcCount++;
  connection.pendingRpc[this.id] = this;
}

RpcCommand.prototype.clear = function() {
  if (!this.timer) return false;
  clearTimeout(this.timer);
  this.connection.pendingRpcCount--;
  delete this.connection.pendingRpc[this.id];
  this.timer = null;
  return true;
};

RpcCommand.prototype.callback = function(err, res, rpc) {
  if (!this.clear()) return this;
  if (this._callback) this._callback(err, res);
  else if (err) this.connection.client.emit('error', err);
  else if (rpc) this.connection.client.emit('jsonrpc', rpc);
  return this;
};
