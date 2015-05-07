'use strict';

var notifications = require('./lib/notifications.js');


var device = 'android';
var token = 'APA91bGuzUprnzzY-PxXlXnbmZmJy_dUz6j4yNMM_SMzUMyUFanhdsOGGuLvt_E_3-OtWrW6Ir01iRmjVBTkcdlklFhqopyIPiNMTpay64PcSjTzBeg04pUWKrQk6Pyi29RYXdaeqP1h';

var msg = {
	alert: 'Noch ein Pups',
	payload: {'messageFrom': 'Dominic'}
};

notifications.send(device, token, msg);