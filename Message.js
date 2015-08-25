////////////////////////////////////////////////
// Message
////////////////////////////////////////////////

module.exports = function(command, callback) {
	
	this.command = command;

	this.callback = callback;

	this.sendTimestamp = undefined;
}

