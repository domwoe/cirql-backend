'use strict';

var notifications = require('./lib/notifications.js');


var device = 'ios';
var token = 'FE66489F304DC75B8D6E8200DFF8A456E8DAEACEC428B427E9518741C92C6660';

var msg = {
	alert: '\uD83D\uDCE7 \u2709 You have a new message',
	payload: {'messageFrom': 'Caroline'}
};

notifications.send(device, token, msg);