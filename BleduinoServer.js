var noble = require('noble'),
	debug = require('debug')('bleduino:debug'),
	error = require('debug')('bleduino:error'),
	trace = require('debug')('bleduino:trace'),
	events = require('events'),
	sleep = require('sleep'),
	util = require('util'),
	Device = require('./Device.js');


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

module.exports = BleduinoServer;