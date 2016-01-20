'use strict'
// **Github:** https://code.teambition.com/server/snapper2-node-client

const jws = require('jws')
const util = require('util')
const EventEmitter = require('events').EventEmitter
const Connection = require('./lib/connection')

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_EXP = 3600 * 24 * 2
const DEFAULT_EXP_THR = 60

module.exports = SnapperProducer

function SnapperProducer (port, host, options) {
  if (!(this instanceof SnapperProducer)) return new SnapperProducer(port, host, options)
  if (!port || typeof port !== 'number') throw new Error('port is required')
  if (!validString(host)) {
    options = host
    host = DEFAULT_HOST
  }
  if (!options || !options.secretKeys || !options.secretKeys.length) throw new Error('secretKeys is required')
  if (!validString(options.producerId)) throw new Error('producerId is required')

  this._algorithm = options.algorithm
  this._expiresInSeconds = options.expiresInSeconds > DEFAULT_EXP_THR ? Math.floor(options.expiresInSeconds) : DEFAULT_EXP
  this._secretKey = Array.isArray(options.secretKeys) ? options.secretKeys[0] : options.secretKeys
  this.producerId = options.producerId

  EventEmitter.call(this)
  this.connection = new Connection(port, host, this)
}

util.inherits(SnapperProducer, EventEmitter)

/* Generates header authorization for PUT/POST requests. */
SnapperProducer.prototype.signAuth = function (payload) {
  payload.exp = Math.floor(Date.now() / 1000) + this._expiresInSeconds
  var header = {typ: 'JWT', alg: this._algorithm || 'HS256'}
  return jws.sign({header: header, payload: payload, secret: this._secretKey})
}

SnapperProducer.prototype.sendMessage = function (room, message) {
  this.connection.send([room, message])
  return this
}

SnapperProducer.prototype.joinRoom = function (room, consumerId, callback) {
  return this.request('subscribe', [room, consumerId], callback)
}

SnapperProducer.prototype.leaveRoom = function (room, consumerId, callback) {
  return this.request('unsubscribe', [room, consumerId], callback)
}

/**
 * Sends RPC Requests.
 * @param {String} RPC request type
 * @param {Array} RPC request parameters
 * @param {Function} Callback function
 *
 * @return {Function} A function that forwards RPC requests when callback is not provided
 *         otherwise {Object} SnapperProducer object
 */
SnapperProducer.prototype.request = function (method, params, callback) {
  var connection = this.connection
  function task (done) {
    connection.sendRpc(method, params, done)
  }

  if (!callback) return task
  task(callback)
  return this
}

SnapperProducer.prototype.close = function () {
  this.connection.close()
  this.emit('close')
}

function validString (str) {
  return str && typeof str === 'string'
}
