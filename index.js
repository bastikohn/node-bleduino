var	BleduinoServer = require('./lib/BleduinoServer.js'),
	bleduino = new BleduinoServer();
	LightBulbService = require('./services/LightBulbService.js')(bleduino),
	WindowCoveringService = require('./services/WindowCoveringService.js')(bleduino);

// Register serviceUUIDs
bleduino.LightBulbService = LightBulbService;
bleduino.WindowCoveringService = WindowCoveringService;

module.exports = bleduino;