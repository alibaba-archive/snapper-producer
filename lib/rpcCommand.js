'use strict'

const Resp = require('respjs')
const jsonrpc = require('jsonrpc-lite')
const TIMEOUT = 60 * 1000

module.exports = RpcCommand

function RpcCommand (connection, method, params, id, callback) {
  var ctx = this

  this.id = id
  this.pending = false
  this.method = method
  this.callback = callback
  this.connection = connection

  var msgObj = jsonrpc.request(this.id, method, params)
  this.data = Resp.encodeBulk(JSON.stringify(msgObj))

  this.timer = setTimeout(function () {
    var error = new Error('Send RPC time out, ' + ctx.id + ', ' + ctx.method)
    error.data = msgObj
    ctx.done(error)
  }, TIMEOUT)
  connection.rpcPendingCount++
  connection.rpcPendingPool[this.id] = this
}

RpcCommand.prototype.clear = function () {
  if (!this.timer) return false
  clearTimeout(this.timer)
  this.connection.rpcPendingCount--
  delete this.connection.rpcPendingPool[this.id]
  this.timer = null
  return true
}

RpcCommand.prototype.done = function (err, res, rpc) {
  if (!this.clear()) return this
  if (this.callback) this.callback(err, res)
  else if (err) this.connection.client.emit('error', err)
  else if (rpc) this.connection.client.emit('jsonrpc', rpc)
  return this
}
