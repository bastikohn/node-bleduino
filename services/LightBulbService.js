var debug = require('debug')('bleduino:debug'),
	error = require('debug')('bleduino:error'),
	trace = require('debug')('bleduino:trace'),
	util = require('util'),
	events = require('events');

module.exports = function(bleduino){

	function LightBulbService(uuid, actionKeyWord) {
		
		events.EventEmitter.call(this);

		var self = this;

		this.uuid = uuid;

		if(actionKeyWord) {
			this.actionKeyWord = actionKeyWord;
		}else{
			this.actionKeyWord = "power";
		}

		this.device = bleduino.registerDevice(uuid);

		var passOnEvent = function(event) {
				self.device.on(event, function(data) {
					self.emit(event, data);
				});
			},
			eventList = ["connected", "disconnected", "event"];
		eventList.forEach(passOnEvent);
	}

	util.inherits(LightBulbService, events.EventEmitter);

	LightBulbService.prototype.setState = function(value, callback) {
		if(!this.device.isReadyToSendMessages()) {
			callback("Device is not ready to send messages");
		} else if(typeof value !== 'boolean') {
			callback('Value is not a boolean');
		} else {
			this.device
				.createMessage({
					'action' : this.actionKeyWord,
					'method': 'set_state',
					'value' : value ? 1 : 0
				})
				.onRequestFinished(callback)
				.send();
		}
	}

	LightBulbService.prototype.getState = function(callback) {
		if(!this.device.isReadyToSendMessages()) {
			callback("Device is not ready to send messages");
		} else {
			this.device
				.createMessage({
					'action' : this.actionKeyWord,
					'method': 'get_state',
				})
				.onRequestFinished(callback)
				.send();
		}
	}

	LightBulbService.prototype.toggleState = function(callback) {
		if(!this.device.isReadyToSendMessages()) {
			callback("Device is not ready to send messages");
		} else {
			this.device
				.createMessage({
					'action' : this.actionKeyWord,
					'method': 'toggle_state',
				})
				.onRequestFinished(callback)
				.send();
		}
	}
	return LightBulbService;
};