var debug = require('debug')('bleduino:debug'),
	error = require('debug')('bleduino:error'),
	trace = require('debug')('bleduino:trace'),
	util = require('util'),
	events = require('events');

module.exports = function(bleduino){

	function WindowCoveringService(uuid, actionKeyWord) {
		
		events.EventEmitter.call(this);

		var self = this;

		this.uuid = uuid;

		if(actionKeyWord) {
			this.actionKeyWord = actionKeyWord;
		}else{
			this.actionKeyWord = "rollo";
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

	util.inherits(WindowCoveringService, events.EventEmitter);

	WindowCoveringService.prototype.moveTo = function(value, callback) {
		if(!this.device.isReadyToSendMessages()) {
			callback("Device is not ready to send messages");
		} else if(typeof value !== 'number') {
			callback('Value is not a number');
		} else {
			this.device
				.createMessage({
					'action' : this.actionKeyWord,
					'method': 'move',
					'value' : parseInt(value)
				})
				.onRequestFinished(callback)
				.send();
		}
	};

	WindowCoveringService.prototype.stop = function(callback) {
		if(!this.device.isReadyToSendMessages()) {
			callback("Device is not ready to send messages");
		} else {
			this.device
				.createMessage({
					'action' : this.actionKeyWord,
					'method': 'stop'
				})
				.onRequestFinished(callback)
				.send();
		}
	};

	WindowCoveringService.prototype.setStateWithoutMoving = function(value, callback) {
		if(!this.device.isReadyToSendMessages()) {
			callback("Device is not ready to send messages");
		} else if(typeof value !== 'number') {
			callback('Value is not a boolean');
		} else {
			this.device
				.createMessage({
					'action' : this.actionKeyWord,
					'method': 'set_state',
					'value' : parseInt(value)
				})
				.onRequestFinished(callback)
				.send();
		}
	};

	WindowCoveringService.prototype.getState = function(callback) {
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
	};

	return WindowCoveringService;
};