'use strict'

var jsonrpc = require('jsonrpc-lite')

var TIMEOUT = 60 * 1000

module.exports = RpcCommand

function RpcCommand (connection, method, params, id, callback) {
  var ctx = this

  this.id = id
  this.pending = false
  this.method = method
  this._callback = callback
  this.connection = connection

  var msgObj = jsonrpc.request(this.id, method, params)
  this.data = connection.bufsp.encode(JSON.stringify(msgObj))

  this.timer = setTimeout(function () {
    ctx.done(new Error('Send RPC time out, ' + ctx.id + ', ' + ctx.method))
  }, TIMEOUT)
  this.connection.pendingRpcCount++
  connection.pendingRpc[this.id] = this
}

RpcCommand.prototype.clear = function () {
  if (!this.timer) return false
  clearTimeout(this.timer)
  this.connection.pendingRpcCount--
  delete this.connection.pendingRpc[this.id]
  this.timer = null
  return true
}

RpcCommand.prototype.done = function (err, res, rpc) {
  if (!this.clear()) return this
  if (this._callback) this._callback(err, res)
  else if (err) this.connection.client.emit('error', err)
  else if (rpc) this.connection.client.emit('jsonrpc', rpc)
  return this
}
