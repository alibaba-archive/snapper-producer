snapper2-producer
====
Snapper2 producer client for node.js.

**`Snapper2 producer` is test in `Snapper2`**

## Snapper2 https://code.teambition.com/server/snapper2

## Demo

```js
var Snapper = require('snapper2-producer');

var client = new Snapper(3001, '127.0.0.1', {
  producerId: 'testProducerId',
  secretKeys: ["tokenXXXXX"]
});

// generate a token for a consumer
var token = client.signAuth({userId: 'userIdxxx'});

// send a message to a room
client.sendMessage('room', 'message');

client.sendMessage('projects/51762b8f78cfa9f357000011', '{"e":":remove:tasks","d":"553f569aca14974c5f806a01"}');

// add a consumer to a room
client.joinRoom('room', 'consumerId', callback);

client.joinRoom('projects/51762b8f78cfa9f357000011', 'lkoH6jeg8ATcptZQFHHH7w~~', function(err, res) {/*...*/});

// remove a consumer from a room
client.leaveRoom('room', 'consumerId', callback);

client.leaveRoom('projects/51762b8f78cfa9f357000011', 'lkoH6jeg8ATcptZQFHHH7w~~', function(err, res) {/*...*/});
```
