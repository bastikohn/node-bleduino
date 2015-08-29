var	BleduinoServer = require('./BleduinoServer.js'),
	bleduino = new BleduinoServer();
	LightBulbService = require('./LightBulbService.js')(bleduino),
	WindowCoveringService = require('./WindowCoveringService.js')(bleduino);

// Register serviceUUIDs
bleduino.LightBulbService = LightBulbService;
bleduino.WindowCoveringService = WindowCoveringService;

module.exports = bleduino;