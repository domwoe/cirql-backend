/**
 * Notifications
 * Manages push notifications
 */

/*jslint node: true */
'use strict';

var bunyan = require('bunyan');
var bunyanLogentries = require('bunyan-logentries');

var log = bunyan.createLogger({
    name: "backend",
    streams: [{
        stream: process.stdout,
        level: "info"
    }, {
        level: 'info',
        stream: bunyanLogentries.createStream({
            token: 'e103b6d1-907f-4cc7-83b4-8908ef866522'
        }),
        type: 'raw'
    }]
});

var apn = require('apn');

 var options = {
 	cert: __dirname + '/../certificates/cert_dev.pem',
 	key: __dirname + '/../certificates/key_dev.pem',
    production: false
};
//var options = {};
var apnConnection = new apn.Connection(options);

var gcm = require('node-gcm');

var sender = new gcm.Sender(process.env.GCM_API_KEY || '');



module.exports = {

	/**
	 * Send push notification
	 * @param  {string}  should be either ios or android
	 * @param  {string} token that identifies device
	 * @param  {object}	has to contain alert and payload 	 
	 */

    send: function(device, token, msg) {

        if (device === 'ios') {

            var myDevice = new apn.Device(token);

            console.log(token)
            console.log(myDevice);

            var note = new apn.Notification();

            note.expiry = Math.floor(Date.now() / 1000) + 3600; // Expires 1 hour from now.
            note.badge = 0;
            note.sound = "ping.aiff";
            note.alert = msg.alert || '';
            note.payload = msg.payload || '';

            apnConnection.pushNotification(note, myDevice);

        } else if (device === 'android') {

        	sender.send(msg.payload, device, function(err, res) {

        		if(err) {
        			log.err('Notifications: Error while sending notification to android: ' + err);
        		}
        	});


        } 

        else {
            log.info('Notifications: Device ' + device + ' not supported');
        }
    }
};