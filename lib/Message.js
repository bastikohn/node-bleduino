////////////////////////////////////////////////
// Message
////////////////////////////////////////////////

function Message(device, command, callback) {
	
	this.device = device;

	this.command = command;

	this.callback = callback;

	this.sendTimestamp = undefined;

	this._onSuccessHandler = undefined;

	this._onErrorHandler = undefined;
}

Message.prototype.onAnswer = Message.prototype.onSuccess = function(handler) {
	this._onSuccessHandler = handler;
	return this;
};

Message.prototype.onError = function(handler) {
	this._onErrorHandler = handler;
	return this;
};

Message.prototype.onRequestFinished = function(handler) {
	this.callback = handler;
	return this;
};

Message.prototype.fireCallbacks = function(error, answer) {
	if(typeof this.callback === 'function') {
		this.callback.call(this, error, answer);
	}
	if(error && typeof error !== 'undefined' && typeof this._onErrorHandler === 'function') {
		this._onErrorHandler.call(this, error);
	} else if(answer && typeof answer !== 'undefined' && typeof this._onSuccessHandler === 'function') {
		this._onSuccessHandler.call(this, answer);
	}
};

Message.prototype.send = function(callback) {
	if(typeof callback === 'function') this.callback = callback;

	if(this.device) {
		this.device.sendMessage(this);
	}
	return this;
}

module.exports = Message;