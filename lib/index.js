'use strict'

const net = require('toa-net')
const EventEmitter = require('events').EventEmitter

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_EXP = 3600 * 24 * 2
const DEFAULT_EXP_THR = 60
const MESSAGE_HIGH_WATER = 50

class SnapperProducer extends EventEmitter {
  constructor (port, host, options) {
    super()

    if (!port || typeof port !== 'number') throw new Error('port is required')
    if (!validString(host)) {
      options = host
      host = DEFAULT_HOST
    }
    if (!options || !options.secretKeys || !options.secretKeys.length) {
      throw new Error('secretKeys is required')
    }
    if (!validString(options.producerId)) throw new Error('producerId is required')

    let secretKeys = Array.isArray(options.secretKeys) ? options.secretKeys : [options.secretKeys]
    let expiresIn = options.expiresIn || options.expiresInSeconds
    expiresIn = expiresIn > DEFAULT_EXP_THR ? Math.floor(expiresIn) : DEFAULT_EXP

    this.queue = new net.Queue()
    this.auth = new net.Auth({
      secrets: secretKeys,
      expiresIn: expiresIn
    })
    this.conn = new net.Client()
    this.conn.getSignature = () => this.auth.sign({id: options.producerId})
    this.conn
      .on('close', () => this.emit('close'))
      .on('end', () => this.emit('end'))
      .on('drain', () => this._flushMessages())
      .on('auth', () => {
        this._flushMessages()
        this.emit('connect')
      })
      .on('reconnecting', (msg) => this.emit('reconnecting', msg))
      .on('error', (error) => this.emit('error', error))
      .connect(port, host)
  }

  signAuth (payload) {
    return this.auth.sign(payload)
  }

  _flushMessages (message) {
    if (!this.conn.connected || this.conn._queue.length) {
      if (message) this.queue.push(message)
      return this
    }

    let messages = []
    let highWater = MESSAGE_HIGH_WATER
    while (this.queue.length && highWater--) messages.push(this.queue.shift())
    if (message) {
      if (this.queue.length) this.queue.push(message)
      else messages.push(message)
    }
    if (messages.length) this.conn.notification('publish', messages)
    return this
  }

  sendMessage (room, message) {
    this._flushMessages([room, message])
    return this
  }

  joinRoom (room, consumerId) {
    return this.request('subscribe', [room, consumerId])
  }

  leaveRoom (room, consumerId) {
    return this.request('unsubscribe', [room, consumerId])
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
  request (method, params) {
    return this.conn.request(method, params)
  }

  close () {
    this.conn.destroy()
  }
}

module.exports = SnapperProducer

function validString (str) {
  return str && typeof str === 'string'
}
