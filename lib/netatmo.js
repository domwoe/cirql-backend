/**
 * Netatmo class
 *
 */

/*jslint node: true */
'use strict';

var Firebase = require('firebase');
var bunyan = require('bunyan');
var bunyanLogentries = require('bunyan-logentries');

var log = bunyan.createLogger({
  name: "backend",
  streams: [
    {
            stream: process.stdout,
            level: "info"
        },
    {
      level: 'info',
      stream: bunyanLogentries.createStream({token: 'e103b6d1-907f-4cc7-83b4-8908ef866522'}),
      type: 'raw'
    }]
});

/** Require configuration file */
var config = require('../config.json');
var fbBaseUrl = config.firebase;

function Netatmo(homeId, roomId, stationId, moduleId) {
  this.homeId = homeId;
  this.roomId = roomId;
  this.stationId = stationId;
  this.moduleId = moduleId;
  this.temperature = null;
  this.timestamp = null;
};

Netatmo.prototype.bind = function(theRoom) {
	this.fbRefNetatmo =  new Firebase(fbBaseUrl+'homes/'+this.homeId+'/sensors/netatmo/stations/'+this.stationId+'/modules/'+this.moduleId+'/');
	//log.info({home: this.homeId, room: this.roomId},'Netatmo FirebaseRef: '+this.fbRefNetatmo);
	// Optimization: Implement a check if new Temperature is different to old one
	this.fbRefNetatmo.on('value', function(fbNetatmo){
		var temperature = fbNetatmo.child('temperature').val();
		var timestamp = fbNetatmo.child('timestamp').val() * 1000;
		if(temperature) {
			this.temperature = temperature;
			theRoom.updateRoomTemperature();
		}

		if (timestamp) {
			this.timestamp = timestamp;
		}
		else{
			log.warn({home: this.homeId, room: this.roomId, station: this.station, module: this.module }, 'Netatmo: Netatmo does not exist!');
		}
	},this);
};


Netatmo.prototype.getTemperature = function() {
	return this.temperature;
};

Netatmo.prototype.getTimestamp = function() {
	return this.timestamp;
};

Netatmo.prototype.setFbRefOff = function() {
	this.fbRefNetatmo.child('temperature').off();
};

module.exports = Netatmo;
