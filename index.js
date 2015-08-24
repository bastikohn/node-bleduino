var noble = require('noble'),
	debug = require('debug')('bleduino:debug'),
	error = require('debug')('bleduino:error'),
	trace = require('debug')('bleduino:trace'),
	events = require('events'),
	sleep = require('sleep'),
	util = require('util');

////////////////////////////////////////////////
// Message
////////////////////////////////////////////////

function Message(command, callback) {
	
	this.command = command;

	this.callback = callback;
}


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

  	var self = this;

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


	this.sendCommandCounter = 0;

	this.pendingMessages = new Array();

}

util.inherits(Device, events.EventEmitter);

// class methods

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
			self.characteristicsLoaded= true;
			self._subscribeToNotificationCharacteristic(self._handleNotification.bind(self));

			debug("Device ("+self.uuid+") has connected."); 
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
	this.events.emit('disconnected');
};

Device.prototype._loadServices = function(callback) {
	trace('Device._loadServices');

	if(!this.noblePeripheral) {
		var errorMessage = 'Bleduino Gerät ist noch nicht verbunden.';
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

	if(this.service == null || this.service === undefined) {
		callback('Bleduino Service noch nicht geladen.');
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
		});

		callback(null,device);
	});
};

Device.prototype.send = function(command, callback) {
	trace('Device.send', command);

	var message = new Message(command, callback);
	this._queueMessage(message);
	if(!this.isSendingMessage) {
		this.isSendingMessage = true;
		this._sendNextPendingMessage(function(error) {
			if(error) {
				console.log(error);
			}
		});
	}
};

Device.prototype._sendNextPendingMessage = function(callback) {
	trace('Device._sendNextPendingMessage');

	if(!this.isConnected) {
		callback("Konnte keine Nachricht versenden. Bleduino ist nicht verbunden.");
		return;
	}

	debug('Send Next Message');

	if(this.hasPendingMessages()) {
		var message = this.pendingMessages[0];
		message.command.id = this.sendCommandCounter++;
		this._sendMessageRepeated(10, message, callback); 
	}else{
		debug('No pending messages found');
	}
};

Device.prototype._sendMessage = function(message, callback) {
	trace('Device._sendMessage', message);
	if(this.writeCharacteristic == undefined) {
		callback('Write Characteristic wurde noch nicht geladen.');
		return;
	}

	var device = this;

	var commandString = JSON.stringify(message.command);
	var data = new Buffer(commandString+'\n', 'ascii')

	var chunkSize = 20;

	var sendSlice = function(sliceToSend, isFinalSlice, numberOfSlice) {
		device.writeCharacteristic.write(sliceToSend, true, function(error) {
			if(error != null) {
				callback(error);
			}
			if (isFinalSlice) {
				callback(null, message);
			}
		});
	}

	for ( var i = 0 ; i <= data.length; i += chunkSize ) {
	    var slice = data.slice( i, ( i + chunkSize ) );
	    var isFinalSlice = i + chunkSize > data.length;
	 	sendSlice(slice, isFinalSlice, i/chunkSize);
	 	sleep.usleep(5);
	}
};

Device.prototype._sendMessageRepeated = function(count, message, callback) {
	trace('Device._sendMessageRepeated', count, message);

	var self = this;
	var sendCount = 0; 

	if(count === undefined || (typeof count !== 'number')) {
		error('Wrong input parameter', count);
		return;
	}

	if(!this.isConnected) {
		var errorMessage = "Device is not connected. UUID:" + this.uuid;
		error(error);
		callback(errorMessage);
		return;
	}

	var trySendMessage = function() {
		sendCount++;
		if(sendCount > count) {
			var errorMessage = "Could not send message after last try #" + count;
			if(typeof callback === 'function') callback(errorMessage);
			error(errorMessage);
			return;
		}
		self._sendMessage(message, function(error, _message){
			if(typeof callback === 'function') callback(error, _message);
		});

		setTimeout(function () {
			if(self._pendingMessageWithId(message.command.id) !== null) {
				debug('Did not receive answer for message in time', message);
				trySendMessage();
			}
		},200);
	};
	trySendMessage();
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

Device.prototype._subscribeToNotificationCharacteristic = function(callback) {
	// Ist Notification Characteristic vorhanden?
	if(this.notifyCharacteristic == undefined) {
		var errorMessage = 'Notification Characteristic wurde noch nicht geladen.';
		error(errorMessage);
		callback(errorMessage);
		return;
	}
	var readBuffer = "";
	this.notifyCharacteristic.on('data', function(data, isNotification){
		readBuffer += data.toString('ascii');
		if(readBuffer.slice(-1) == "}") {
			try {
				var jsonPart = "{" + readBuffer.split("{").pop().split("}").shift() + "}";
				var answerObject = JSON.parse(jsonPart);
			}catch(e) {
				console.log(readBuffer);
				callback(e); 
			}finally {
				readBuffer = "";
			}
			callback(null, answerObject);
		}
	});
};

Device.prototype._handleNotification = function(error, answer) {
	trace('Device._handleNotification', error, answer);
	
	if(error) {
		error('Handle notification did receive error', error);
		return;
	}

	if(!answer || (typeof answer !== 'object') ) {
		error('Wrong input parameter: uuid', uuid);
		return;
	}

	if(answer.id == undefined || answer.event !== undefined && answer.event === true || this.pendingMessages.length == 0) {
		debug("Unknown message received. Could be an event.");
		this.server.broadcastEvent({device: this, message: answer});
	}else{
		var receivedPendingMessage = this._pendingMessageWithId(answer.id);
		
		debug('Received pending message', receivedPendingMessage);
		
		if(receivedPendingMessage !== null) {
			// Did receive answer for message.
			receivedPendingMessage.callback(null, answer);
			this.isSendingMessage = false;

			this._dequeueMessage(receivedPendingMessage);

			// Successfully received answer for message. Next message can be sent.
			this._sendNextPendingMessage();
		}
	}
};


////////////////////////////////////////////////
// Bleduino Server
////////////////////////////////////////////////

function BleduinoServer() {
	trace('BleduinoServer()');
	events.EventEmitter.call(this);

	this.devices = [];

	this.isScanning = false;
}

util.inherits(BleduinoServer, events.EventEmitter);

BleduinoServer.prototype.start = function() {
	trace('BleduinoServer.start');
	var self = this;

	noble.on('stateChange', function(state){
		// Start scanning for devices, if the BLE service has been powered on.
		if(state == 'poweredOn') {
			self._startScanning();
		}
	});	

	noble.on('discover', function(peripheral) {
		// A new device has been discovered. Connect to it, if it has been registered.
		if(self.isDeviceWithUUIDRegistered(peripheral.uuid)) {
			var device = self.registeredDeviceWithUUID(peripheral.uuid);
			peripheral.connect(function (error) {
				if(error != null) {	
					error('Could not connect to device with uuid: '+peripheral.uuid);
					return;
				}
				debug('Connected to device', peripheral.uuid);
				// Connection to Bleduino has been established.
				device._connectionEstablished(peripheral);

				if(self._allRegisteredDevicesConnected()) {
					debug('All registerd devices are connected');
					self._stopScanning();
				}
			});	
			peripheral.on('disconnect', function() {
				// The connection to the device is interrupted. Restart Scanning for devices.
				device._connectionLost();
				self._startScanning();
			});
		}
	});

	noble.on('scanStart', function() {
		self.isScanning = true;
		self.emit('startScanning');
		debug('startScanning');
	});

	noble.on('scanStop', function() {
		self.isScanning = false;
		self.emit('stopScanning');
		debug('stopScanning');
	});
};

BleduinoServer.prototype._startScanning = function() {
	trace('BleduinoServer._startScanning');
	// Start scanning for devices, if the BLE service has been powered on.
	if(noble.state == 'poweredOn') {
		if(this.isScanning) {
			this._stopScanning
		}
		noble.startScanning(this.serviceUUIDs, false);
	}else{
		error('BLE service is not powered on. (Current State:'+noble.state+')');
	}
};

BleduinoServer.prototype._stopScanning = function() {
	trace('BleduinoServer._stopScanning');
	noble.stopScanning();
};

BleduinoServer.prototype._allRegisteredDevicesConnected = function() {
	trace('BleduinoServer._allRegisteredDevicesConnected');
	var unconnectedRegisteredDevices = this.devices.filter(function(device) {
		return !device.isConnected;
	});
	return unconnectedRegisteredDevices.length == 0;
};

BleduinoServer.prototype.registerDevice = function(uuid) {
	trace('BleduinoServer.registerDevice', uuid);

	if(!uuid || (typeof uuid !== 'string') ) {
		error('Wrong input parameter: uuid', uuid);
		return;
	}

	var device = this.registeredDeviceWithUUID(uuid);
	if(device === undefined) {
		device = new Device(uuid, this);
		this.devices.push(device);
		debug('Did register device', uuid);
		// New device has been registered. Scanning has to be restarted.
		this._startScanning();
	}
	return device;
};

BleduinoServer.prototype.isDeviceWithUUIDRegistered = function(uuid) {
	trace('BleduinoServer.isDeviceWithUUIDRegistered', uuid);
	if(!uuid || (typeof uuid !== 'string') ) {
		error('Wrong input parameter: uuid', uuid);
		return;
	}

	return this.registeredDeviceWithUUID(uuid) != null;
};

BleduinoServer.prototype.registeredDeviceWithUUID = function(uuid) {
	trace('BleduinoServer.registeredDeviceWithUUID', uuid);

	if(!uuid || (typeof uuid !== 'string') ) {
		error('Wrong input parameter: uuid', uuid);
		return;
	}

	var devicesWithUUID = this.devices.filter(function(device) {
		return device.uuid == uuid;
	});

	if(devicesWithUUID.length == 1) {
		return devicesWithUUID[0];
	}else{
		return undefined;
	}
};

BleduinoServer.prototype.broadcastEvent = function(data) {
	this.devices.forEach(function(device) {
		device.emit("Event", data);
	});
}

var exports = module.exports = new BleduinoServer();