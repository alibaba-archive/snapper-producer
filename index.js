'use strict';
// **Github:** https://code.teambition.com/server/snapper2-node-client

var jws = require('jws');
var util = require('util');
var EventEmitter = require('events').EventEmitter;

var Connection = require('./lib/connection');

var defaultHost = '127.0.0.1';

module.exports = SnapperClient;

function SnapperClient(port, host, options) {
  if (!(this instanceof SnapperClient)) return new SnapperClient(port, host, options);
  if (!port || typeof port !== 'number') throw new Error('Port is required');
  if (!validString(host)) {
    options = host;
    host = defaultHost;
  }
  if (!options || !options.secretKeys || !options.secretKeys.length) throw new Error('secretKeys is required');

  this._options = options;
  this._secretKeys = Array.isArray(options.secretKeys) ? options.secretKeys : [options.secretKeys];
  this._expiresInSeconds = options.expiresInSeconds > 60 ? Math.floor(options.expiresInSeconds) : 3600 * 24 * 2;

  EventEmitter.call(this);

  this.connection = new Connection(port, host, this);

  // 自动发起验证
  this.auth();
}

util.inherits(SnapperClient, EventEmitter);

// 生成 header authorization，用于 PUT、POST 请求验证
SnapperClient.prototype.signAuth = function(payload) {
  payload = payload || {};
  payload.exp = Math.floor(Date.now() / 1000) + this._expiresInSeconds;

  return sign(payload, this._secretKeys[0], this._options);
};

SnapperClient.prototype.sendMessage = function(room, message) {
  if (!validString(room) || !validString(message))
    throw new Error('arguments must be string');
  this.connection.send([room, message]);
};
SnapperClient.prototype.joinRoom = function(room, consumerId, callback) {
  if (!validString(room) || !validString(consumerId))
    throw new Error('arguments must be string');
  this.connection.sendRPC('subscribe', [room, consumerId], callback);
};
SnapperClient.prototype.leaveRoom = function(room, consumerId, callback) {
  if (!validString(room) || !validString(consumerId))
    throw new Error('arguments must be string');
  this.connection.sendRPC('unsubscribe', [room, consumerId], callback);
};
SnapperClient.prototype.auth = function() {
  var ctx = this;
  this.connection.sendRPC('auth', [this.signAuth()], function(err, res) {
    if (err !== null) ctx.emit('error', err);
    ctx.connection.connected = true;
    ctx.emit('connect');
    ctx.connection.rescuePending();
    ctx.connection.execQueue();
  });
};

SnapperClient.prototype.close = function() {
  this.connection.destroy();
  this.emit('close');
  this.removeAllListeners();
};


function sign(payload, secretOrPrivateKey, options) {
  options = options || {};

  var header = {typ: 'JWT', alg: options.algorithm || 'HS256'};
  return jws.sign({header: header, payload: payload, secret: secretOrPrivateKey});
}

function validString(str) {
  return str && typeof str === 'string';
}
