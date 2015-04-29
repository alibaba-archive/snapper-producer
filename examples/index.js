'use strict';
// **Github:** https://code.teambition.com/server/snapper2-node-client

var Snapper = require('../index');

var client = new Snapper(7800, 'http://snapper.project.bi', {
  producerId: 'testProducerId',
  secretKeys: ["tokenXXXXXXX"]
});

// var token = client.signAuth({userId: 'userIdxxx'});
// client.sendMessage('room', 'message');
// client.joinRoom('room', 'consumerId', callback);
// client.leaveRoom('room', 'consumerId', callback);

module.exports = client;
