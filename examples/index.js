'use strict';
// **Github:** https://code.teambition.com/server/snapper2-node-client

var Snapper = require('../index');

var client = new Snapper(3001, '127.0.0.1', {
  producerId: 'testProducerId',
  secretKeys: ["tokenXXXXX"]
});

// var token = client.signAuth({userId: 'userIdxxx'});
// client.sendMessage('room', 'message');
// client.joinRoom('room', 'consumerId', callback);
// client.leaveRoom('room', 'consumerId', callback);

module.exports = client;
