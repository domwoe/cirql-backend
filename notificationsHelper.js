'use strict';

var notifications = require('./lib/notifications.js');


var device = 'ios';
var token = '0a956eeaf63df6dbebbef8fdcfe26f76c8e878ec0155432dd02936ac1d6a0f1f';

var msg = {
	alert: 'Noch ein Pups',
	payload: {'messageFrom': 'Dominic'}
};

notifications.send(device, token, msg);