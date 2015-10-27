
const net = require('net')
const Bufsp = require('bufsp')
const jsonrpc = require('jsonrpc-lite')
const RpcCommand = require('./rpcCommand')

var rpcId = 0

module.exports = Connection

function Connection (port, host, client) {
  this.RETRY_DELAY = 3000
  this.MESSAGE_HIGH_WATER = 20
  this.RPC_HIGH_WATER = 100
  this.MAX_ATTEMPTS = 50

  this.client = client
  this.port = port
  this.host = host

  this.ended = false
  this.connected = false

  this.attempts = 0
  this.authId = 0
  this.rpcCount = 0
  this.messagesCount = 0
  this.rpcPendingCount = 0

  this.rpcMessageQueue = []
  this.rpcPendingPool = Object.create(null)

  this.connect()
}

Connection.prototype.send = function (params) {
  this.messagesCount++
  this.rpcMessageQueue.push(params)
  this.execQueue()
}

Connection.prototype.sendRpc = function (method, params, callback, force) {
  this.rpcCount++
  if (this.ended) throw new Error('Client have been closed!')

  var command
  try {
    command = new RpcCommand(this, method, params, ++rpcId, callback)
    if (this.connected || force) {
      command.pending = true
      this.socket.write(command.data)
    }
  } catch (err) {
    if (callback) callback(err)
    else this.client.emit('error', err)
    return null
  }

  return command
}

Connection.prototype.execQueue = function () {
  if (this.rpcPendingCount <= this.RPC_HIGH_WATER) {
    while (this.rpcMessageQueue.length) this.sendRpc('publish', this.rpcMessageQueue.splice(0, this.MESSAGE_HIGH_WATER))
  }
}

Connection.prototype.resendRpc = function () {
  var ctx = this
  var rpcPendingPool = this.rpcPendingPool

  Object.keys(rpcPendingPool)
    .sort(function (a, b) {
      return +a - b
    })
    .map(function (id) {
      if (rpcPendingPool[id].pending) return
      rpcPendingPool[id].pending = true
      ctx.socket.write(rpcPendingPool[id].data)
    })
}

Connection.prototype.destroy = function () {
  if (this.ended || !this.socket) return
  this.connected = false
  this.socket.unpipe(this.bufsp)
  this.socket.removeAllListeners(['connect', 'data', 'error', 'close'])
  this.socket.end()
  this.socket = null
}

Connection.prototype.auth = function () {
  var ctx = this
  var token = this.client.signAuth({producerId: this.client.producerId})
  if (this.authCommand) this.authCommand.clear()

  this.authCommand = this.sendRpc('auth', [token], function (err, res) {
    ctx.authCommand = null
    if (err) {
      ctx.client.emit('error', err)
      return ctx.client.close()
    }
    ctx.socket.id = res.id
    ctx.connected = true
    ctx.client.emit('connect')
    ctx.execQueue()
  }, true)
  return this
}

Connection.prototype.connect = function () {
  var ctx = this

  this.connected = false
  if (this.socket) this.destroy()

  this.socket = net.createConnection({
    host: this.host,
    port: this.port
  })

  this.socket.setTimeout(0)
  this.socket.setNoDelay(true)
  this.socket.setKeepAlive(true)

  this.bufsp = new Bufsp({
    encoding: 'utf8',
    returnString: true
  })

  this.bufsp
    .on('data', function (message) {
      if (message == null) return
      if (message instanceof Error) {
        return ctx.client.emit('error', message)
      }

      var res = jsonrpc.parse(message)
      if (res.type === 'invalid') {
        return ctx.client.emit('error', new Error('Parse error: ' + message))
      }

      if (res.type !== 'success' && res.type !== 'error') {
        return ctx.client.emit('error', new Error('Unhandle chunk: ' + message))
      }

      var rpc = ctx.rpcPendingPool[res.payload.id]
      if (!rpc) return ctx.client.emit('warn', new Error('Unhandle RPC: ' + message))

      if (res.type === 'success') return rpc.done(null, res.payload.result, res.payload)
      // Reconnect due to successful connection followed by authentication fails (i.e. server restart).
      if (ctx.connected && res.payload.error.code === 400) ctx.connect()
      else rpc.done(res.payload.error)
    })
    .on('drain', function () {
      ctx.execQueue()
    })
    .on('error', function (error) {
      ctx.client.emit('error', error)
    })

  this.socket
    .on('connect', function () {
      // Reset status.
      ctx.attempts = 0
      ctx.RETRY_DELAY = 3000
      ctx.resendRpc()
    })
    .on('error', function (error) {
      ctx.client.emit('error', error)
    })
    .on('close', function () {
      if (!ctx.ended) ctx.reconnect()
    })

  this.socket.pipe(this.bufsp)
  // Automatic authentication.
  this.auth()
  return this
}

Connection.prototype.reconnect = function () {
  var ctx = this
  this.connected = false
  if (this.ended) return

  // Reset rpcPendingPool.
  Object.keys(this.rpcPendingPool)
    .map(function (id) {
      ctx.rpcPendingPool[id].pending = false
    })

  if (++this.attempts <= this.MAX_ATTEMPTS) {
    this.RETRY_DELAY *= 1.2
    if (this.RETRY_DELAY > 10000) this.RETRY_DELAY = 10000

    setTimeout(function () {
      ctx.connect()
      ctx.resendRpc()
      ctx.client.emit('reconnecting', {
        delay: ctx.RETRY_DELAY,
        attempts: ctx.attempts
      })
    }, this.RETRY_DELAY)
  } else {
    this.destroy()
  }
}

Connection.prototype.close = function () {
  this.destroy()
  this.ended = true
  var rpcPendingPool = this.rpcPendingPool
  Object.keys(rpcPendingPool)
    .map(function (id) {
      rpcPendingPool[id].done(new Error('Client have been closed!'))
    })
}
