'use strict'
// **Github:** https://code.teambition.com/server/snapper2-node-client

var jws = require('jws')
var util = require('util')
var EventEmitter = require('events').EventEmitter

var Connection = require('./lib/connection')

var defaultHost = '127.0.0.1'

module.exports = SnapperProducer

function SnapperProducer (port, host, options) {
  if (!(this instanceof SnapperProducer)) return new SnapperProducer(port, host, options)
  if (!port || typeof port !== 'number') throw new Error('Port is required')
  if (!validString(host)) {
    options = host
    host = defaultHost
  }
  if (!options || !options.secretKeys || !options.secretKeys.length) throw new Error('secretKeys is required')
  if (!validString(options.producerId)) throw new Error('producerId is required')

  this._options = options
  this._secretKeys = Array.isArray(options.secretKeys) ? options.secretKeys : [options.secretKeys]
  this._expiresInSeconds = options.expiresInSeconds > 60 ? Math.floor(options.expiresInSeconds) : 3600 * 24 * 2
  this.producerId = options.producerId

  EventEmitter.call(this)

  this.connection = new Connection(port, host, this)
}

util.inherits(SnapperProducer, EventEmitter)

// 生成 header authorization，用于 PUT、POST 请求验证
SnapperProducer.prototype.signAuth = function (payload) {
  payload = payload || {}
  payload.exp = Math.floor(Date.now() / 1000) + this._expiresInSeconds

  return sign(payload, this._secretKeys[0], this._options)
}

SnapperProducer.prototype.sendMessage = function (room, message) {
  if (!validString(room) || !validString(message)) {
    throw new Error('arguments must be string')
  }
  this.connection.send([room, message])
  return this
}

SnapperProducer.prototype.joinRoom = function (room, consumerId, callback) {
  if (!validString(room) || !validString(consumerId)) {
    throw new Error('arguments must be string')
  }
  this.connection.sendRPC('subscribe', [room, consumerId], callback)
  return this
}

SnapperProducer.prototype.leaveRoom = function (room, consumerId, callback) {
  if (!validString(room) || !validString(consumerId)) {
    throw new Error('arguments must be string')
  }
  this.connection.sendRPC('unsubscribe', [room, consumerId], callback)
  return this
}

SnapperProducer.prototype.close = function () {
  if (this.connection.ended) return
  this.connection.destroy()
  this.connection.ended = true
  for (var id in this.connection.pendingRpc)
    this.connection.pendingRpc[id].callback(new Error('Client have been closed!'))
  this.emit('close')
}

function sign (payload, secretOrPrivateKey, options) {
  options = options || {}

  var header = {typ: 'JWT', alg: options.algorithm || 'HS256'}
  return jws.sign({header: header, payload: payload, secret: secretOrPrivateKey})
}

function validString (str) {
  return str && typeof str === 'string'
}
