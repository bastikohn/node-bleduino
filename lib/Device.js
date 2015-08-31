var debug = require('debug')('bleduino:debug'),
	error = require('debug')('bleduino:error'),
	trace = require('debug')('bleduino:trace'),
	events = require('events'),
	util = require('util'),
	Message = require('./Message.js');

const TIMESPAN_TO_WAIT_FOR_ANSWER_TO_ARRIVE = 300;
const MAX_NUMBER_OF_TRIES_TO_SEND_MESSAGE = 10;
const TIMEOUT_BETWEEN_SLICES = 1;

////////////////////////////////////////////////
// Device
////////////////////////////////////////////////

// UUID: fff1, Properties: ['read', 'writeWithoutResponse, 'notify']
// UUID: fff2, Properties: ['read']
// UUID: fff3, Properites: ['write']
// UUID: fff4, Properties: ['notify']
// UUID: fff5, Properties: ['read']

// Constructor
function Device(uuid, server) {
  	
  	events.EventEmitter.call(this);

  	// Reference to the Bleduino Server.
  	this.server = server;

  	// Define Constants
  	this.serviceUUIDs = ['fff0'];
	this.notifyCharacteristicUUID = 'fff4';
	this.writeCharacteristicUUID = 'fff1';

  	// Sets the address of the Bleduino Controller
	this.uuid = uuid;

	// Is the Bleduino Controller connected?
	this.isConnected = false;

	// Are the write an notify notifications loaded and is communication possible?
	this.characteristicsLoaded = false;

	// Is there currently a message been sent?
	this.isSendingMessage = false;

	// Reference to the noble peripheral object
	this.noblePeripheral = null;

	// Reference to the noble service
	this.service = null;

	// Reference to the write characteristic. Messages to the Bleduino Controller
	// will be send via this characterisitc object.
	this.writeCharacteristic = null;

	// Reference to the notify characteristic. Answers and Events from Bleduino
	// will be received by this characteristic
	this.notifyCharacteristic = null;

	// Pending messages will be buffered into this queue. They will be removed,
	// as soon as an answer arrives.
	this.pendingMessages = new Array();
}

util.inherits(Device, events.EventEmitter);

Device.prototype.disconnect = function() {
	var self = this;
	this.noblePeripheral.disconnect(function(errorMessage) {
		if(errorMessage) {
			error(errorMessage);
			return;
		}
		self._connectionLost();
	});
};

Device.prototype._connectionEstablished = function(noblePeripheral) {
	trace('Device.()');

	var self = this;

	self.isConnected = true;

	self.noblePeripheral = noblePeripheral;

	self._loadServices(function(errorMessage, device) {
		if(errorMessage) {
			error(errorMessage);
			return;
		}
		self._loadCharacteristics(function(errorMessage, device) {
			if(errorMessage) {
				error(errorMessage);
				return;
			}
			self.characteristicsLoaded = true;
			self._subscribeToNotificationCharacteristic(self._handleNotification.bind(self));

			debug("Device has connected.", self.uuid); 
			self.emit('connected');
		});
	});
};

Device.prototype._connectionLost = function() {
	trace('Device._connectionLost');
	debug('Lost connection to device', this.uuid);

	this.isConnected = false;
	this.characteristicsLoaded = false;
	this.writeCharacteristic = null;
	this.notifyCharacteristic = null;
	this.emit('disconnected');
};

Device.prototype._loadServices = function(callback) {
	trace('Device._loadServices');

	if(!this.isConnected) {
		var errorMessage = 'Bleduino device is not yet connected.';
		error(errorMessage);
		callback(errorMessage);
		return;
	}

	var self = this;
	this.noblePeripheral.discoverServices(this.serviceUUIDs, function(errorMessage, services){
		if(errorMessage) {
			error(errorMessage);
			callback(errorMessage);
			return;
		}
		// Bleduino devices offer only a single service. If more services are found, then
		// it is probably an unknown device.
		if(services.length == 1) {
			self.service = services[0];
			callback(null, self);
		}else{
			error('More then one service found. This is probably not an Bleduino device.');
		}
	});
};

Device.prototype._loadCharacteristics = function(callback) {
	trace('Device._loadCharacteristics');

	if(!this.service || typeof this.service !== 'object') {
		var errorMessage = 'Bleduino Service is not loaded.';
		error(errorMessage);
		callback(errorMessage);
		return;
	}

	var device = this;
	this.service.discoverCharacteristics([this.writeCharacteristicUUID, this.notifyCharacteristicUUID], function(error, characteristics) {
		// Ist bei der Suche nach Charackteristika ein Fehler aufgetreten?
		if(error != null) {
			callback(error);
			return;
		}

		characteristics.forEach(function(characteristic){
			if(characteristic.uuid == device.notifyCharacteristicUUID) {
				device.notifyCharacteristic = characteristic;
			}
			if(characteristic.uuid == device.writeCharacteristicUUID) {
				device.writeCharacteristic = characteristic;
			}
			characteristic.on('broadcase', function(state) {
				debug('Broadcase Event:', state);
			});
		});

		callback(null,device);
	});
};

Device.prototype._subscribeToNotificationCharacteristic = function(callback) {
	// Iss notification characteristic loaded?
	if(this.notifyCharacteristic == undefined) {
		var errorMessage = 'Notification characteristic is not yet loaded.';
		error(errorMessage);
		callback(errorMessage);
		return;
	}

	var readBuffer = "";
	this.notifyCharacteristic.on('data', function(data, isNotification){
		// Add received string to readbuffer.
		readBuffer += data.toString('ascii');
		if(readBuffer.slice(-1) == "}") {
			try {
				// It happens the diagnostic information is sent over the BLE connection.
				// We only want to interpret correct JSON data.
				// E.g.: "Unknown string data {'ourObject': true}" => "{'ourObject': true}"
				var jsonData = "{" + readBuffer.split("{").pop().split("}").shift() + "}";
				// Interpret JSON data.
				var answerObject = JSON.parse(jsonData);
				callback(null, answerObject);
			}catch(e) {
				error(e, readBuffer);
				callback(e); 
			}finally {
				readBuffer = "";
			}
		}
	});
};

Device.prototype.isReadyToSendMessages = function() {
	trace('Device.isReadyToSendMessages');

	return this.isConnected && this.characteristicsLoaded;
}

Device.prototype.createMessage = function(command, callback) {
	trace('Device.createMessage', command);

	// Save the command and callback in a new message object.
	var message = new Message(this, command, callback);
	return message;
};

Device.prototype.sendMessage = function(message) {
	trace('Device.send', message);

	if(!this.isConnected) {
		errorMessage = "Could not send next pending message. Device is disconnected.";
		error(errorMessage);
		message.fireCallbacks(errorMessage);
		return;
	}

	// Save the message object for the duration of the sending process.
	this._queueMessage(message);
	
	// If there are currently no messages been sent, send this just enqueued message.
	if(!this.isSendingMessage) {
		this.isSendingMessage = true;
		this._sendNextPendingMessage();
	}
	return message;
};

Device.prototype.send = function(command, callback) {
	trace('Device.send', command);

	if(!this.isConnected) {
		errorMessage = "Could not send next pending message. Device is disconnected.";
		error(errorMessage);
		callback(errorMessage);
		return;
	}

	// Save the command and callback in a new message object.
	var message = new Message(command, callback);

	// Save the message object for the duration of the sending process.
	this._queueMessage(message);
	
	// If there are currently no messages been sent, send this just enqueued message.
	if(!this.isSendingMessage) {
		this.isSendingMessage = true;
		this._sendNextPendingMessage();
	}
};

Device.prototype._sendNextPendingMessage = function() {
	trace('Device._sendNextPendingMessage');

	if(!this.isConnected) {
		error("Could not send next pending message. Device is disconnected.");
		return;
	}

	debug('Send Next Message');

	if(this.hasPendingMessages()) {
		var message = this.pendingMessages[0];
		message.command.id = this._getCommandCounterForNewMessage();
		this._sendMessageRepeated(MAX_NUMBER_OF_TRIES_TO_SEND_MESSAGE, message, message.callback); 
	}else{
		debug('No pending messages found');
	}
};

Device.prototype._sendMessageRepeated = function(count, message) {
	trace('Device._sendMessageRepeated', count, message);

	var self = this,
		sendCount = 0,
		sendMessageAgain = function() {
			if(self._pendingMessageWithId(message.command.id) !== null) {
				debug('Did not receive answer for message in time', message);
				trySendMessage();
			}
		},
		trySendMessage = function() {
			// If the maximum sendcount was reached, abort.
			if(sendCount++ > count) {
				var errorMessage = "Could not send message after last try #" + count;
				message.fireCallbacks(errorMessage);
				error(errorMessage);
				// Could not send message. If there are more pending messages, try sending them.
				self._dequeueMessage(message);
				self._sendNextPendingMessage();
				return;
			}
			self._sendMessage(message);
			setTimeout(sendMessageAgain, TIMESPAN_TO_WAIT_FOR_ANSWER_TO_ARRIVE);
		};


	if(count === undefined || (typeof count !== 'number')) {
		error('Wrong input parameter', count);
	}else if(!this.isConnected) {
		var errorMessage = "Device is not connected. UUID:" + this.uuid;
		error(errorMessage);
		message.fireCallbacks(errorMessage);
	} else {
		trySendMessage();
	}
};

Device.prototype._sendMessage = function(message) {
	trace('Device._sendMessage', message);
	
	// Check if the write notification is already loaded.
	if(this.writeCharacteristic == undefined) {
		var errorMessage = 'Write Characteristic is not yet loaded.';
		error(errorMessage);
		message.fireCallbacks(errorMessage);
		return;
	}

	var self = this,
		commandString = JSON.stringify(message.command),
		data = new Buffer(commandString+'\n', 'ascii'),
		chunkSize = 20,
		sendSlice = function(sliceToSend, isFinalSlice, numberOfSlice) {
			self.writeCharacteristic.write(sliceToSend, true, function(errorMessage) {
				if(errorMessage != null) {
					error('Could not write to characteristic', errorMessage);
					message.fireCallbacks(errorMessage);
				}
				if (isFinalSlice) {
					debug('Message was successfully written to characteristic');
					message.sendTimestamp = Date.now();
				}
			});
		},
		i = 0;
		evaluateSendingSlice = function() {
			var slice = data.slice( i, ( i + chunkSize ) );
		    var isFinalSlice = i + chunkSize > data.length;
		 	sendSlice(slice, isFinalSlice, i/chunkSize);
		 	if (i <= data.length) {
		 		i += chunkSize
		 		if(typeof TIMEOUT_BETWEEN_SLICES === 'number' && TIMEOUT_BETWEEN_SLICES >= 0) {
		 			setTimeout(evaluateSendingSlice, parseInt(TIMEOUT_BETWEEN_SLICES));
		 		}else{
		 			evaluateSendingSlice();
		 		}
		 	}
		};

	evaluateSendingSlice();
};

Device.prototype.hasPendingMessages = function() {
	trace('Device.hasPendingMessages');

	return this.pendingMessages.length > 0;
};

Device.prototype._pendingMessageWithId = function(id) {
	trace('Device.pendingMessageWithId', id);
	
	if(id === undefined || (typeof id !== 'number')) {
		error('Wrong input parameter "id"', id);
		return;
	}

	var filteredMessages = this.pendingMessages.filter(function(message) {
		if(message.command.id !== undefined) {
			return message.command.id == id;
		}
		return false
	});
	
	debug('filteredMessages', filteredMessages);
	if(filteredMessages.length == 1) {
		return filteredMessages[0];
	}else{
		return null;
	}
};

Device.prototype._oldestPendingMessage = function() {
	trace('Device.oldestPendingMessage');

	if(this.pendingMessages.length >= 1) {
		return this.pendingMessages[0];
	}else{
		return null;
	}
};

Device.prototype._queueMessage = function(message) {
	trace('Device._queueMessage', message);
	
	if(!message || (typeof message !== 'object')) {
		error('Wrong input parameter "message"', message);
		return;
	}
	
	this.pendingMessages.push(message);
};

Device.prototype._dequeueMessage = function(message) {
	trace('Device._dequeueMessage', message);

	if(!message || (typeof message !== 'object')) {
		error('Wrong input parameter "message"', message);
		return;
	}

	var index = this.pendingMessages.indexOf(message);
	debug('Index of message in pending Message', index, message, this.pendingMessages);

	if (index > -1) {
	    this.pendingMessages.splice(index, 1);
	}else{
		error('Message not in peding messages array', message);
	}
};

Device.prototype._getCommandCounterForNewMessage = function() {
	// Initialize static variable 'sendCommandCounter' to 
	if ( typeof this.sendCommandCounter == 'undefined' ) {
        this.sendCommandCounter = 0;
    }
    return this.sendCommandCounter++;
};

// TODO: If an answer is corrupt, try sending it again instead of failing.

Device.prototype._handleNotification = function(errorMessage, answer) {
	trace('Device._handleNotification', errorMessage, answer);
	
	var self = this,
		handleError = function(errorMessage) {
			// We have to tell the message that it has failed.
			var mostLikelyFailedMessage = self._oldestPendingMessage()
			if(mostLikelyFailedMessage != null && typeof mostLikelyFailedMessage.callback === 'function') {
				mostLikelyFailedMessage.fireCallbacks(errorMessage);
			}
		},
		receivedUnknownMessage = function(message) {
			debug("Unknown message received. Could be an event.");
			self.server.broadcastEvent({device: self, message: answer});
		};

	if(errorMessage) {
		error('Handle notification did receive error', errorMessage);
		handleError(errorMessage);
	} else if(!answer || (typeof answer !== 'object') ) {
		error('Wrong input parameter: answer', answer);
		handleError(errorMessage);
	} else if(answer.id == undefined) {
		// ID field missing -> Unknown message format.
		receivedUnknownMessage(answer);
	} else if(answer.event !== undefined && answer.event === true) {
		// Event flag == true -> Unknown message (which is handled like an event) format.
		receivedUnknownMessage(answer);
	} else {
		var receivedPendingMessage = this._pendingMessageWithId(answer.id);
		debug('Received pending message', receivedPendingMessage);
		if(receivedPendingMessage) {
			// Did receive answer for message.
			this.isSendingMessage = false;
			this._dequeueMessage(receivedPendingMessage);
			// Successfully received answer for message. Next message can be sent.
			this._sendNextPendingMessage();
			receivedPendingMessage.fireCallbacks(null, answer);
		}
	}
};

module.exports = Device;