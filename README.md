snapper2-producer
====
Snapper2 producer client for node.js.

**`Snapper2-producer` is test in `Snapper2`**

## Snapper2 https://code.teambition.com/server/snapper2

## Demo

```js
var Producer = require('snapper2-producer')

var producer = new Producer(7800, 'http://snapper.project.bi', {
  producerId: 'testProducerId',
  secretKeys: ["tokenXXXXXXX"]
})

// generate a token for a consumer
var token = producer.signAuth({userId: 'userIdxxx'})

// send a message to a room
producer.sendMessage('room', 'message')

producer.sendMessage('projects/51762b8f78cfa9f357000011', '{"e":":remove:tasks","d":"553f569aca14974c5f806a01"}')

// add a consumer to a room
producer.joinRoom('room', 'consumerId', callback)

producer.joinRoom('projects/51762b8f78cfa9f357000011', 'lkoH6jeg8ATcptZQFHHH7w~~', function (err, res) {/*...*/})

// remove a consumer from a room
producer.leaveRoom('room', 'consumerId', callback)

producer.leaveRoom('projects/51762b8f78cfa9f357000011', 'lkoH6jeg8ATcptZQFHHH7w~~', function (err, res) {/*...*/})
```

## API

```js
var Producer = require('snapper2-producer')
```

### new Producer(port[, host], options)

```js
var producer = new Producer(7700, '127.0.0.1', {
  secretKeys: 'secretKeyXXX',
  producerId: 'myproducerId'
})
```
- `port`: `Number`, Snapper2 server port.
- `host`: `String`, Snapper2 server host, default to `'127.0.0.1'`.

- `options.producerId`: `String`, producer's name, use for log.
- `options.secretKeys`: A array of string or buffer containing either the secret for HMAC algorithms, or the PEM encoded private key for RSA and ECDSA.
- `options.expiresInSeconds`: default to `3600 * 24`, one day.
- `options.algorithm`: `String`, default to `'HS256'`.


### producer.prototype.signAuth(payload)

- `payload`: `Object`.

Generate a token string. `payload` should have `userId` property that Snapper2 server determine which room the consumer should auto join (similar to handshake).

### producer.prototype.sendMessage(room, message)

- `room`: `String`
- `message`: `String`

Send a message to a room, the message will be broadcast to all consumers in the room.

### producer.prototype.joinRoom(room, consumerId[, callback])

- `room`: `String`
- `consumerId`: `String`
- `callback`: `Function`

Let a consumer join to a room by it's consumerId.

### producer.prototype.leaveRoom(room, consumerId[, callback])

- `room`: `String`
- `consumerId`: `String`
- `callback`: `Function`

Let a consumer leave from a room by it's consumerId.

### producer.prototype.close()

Close the producer client.
