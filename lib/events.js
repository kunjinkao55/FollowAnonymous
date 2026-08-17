const { EventEmitter } = require('events');

const events = new EventEmitter();
events.setMaxListeners(100);

module.exports = events;