/**
 * Netatmo class
 *
 */

/*jslint node: true */
'use strict';

var Firebase = require('firebase');
var bunyan = require('bunyan');

var log = bunyan.createLogger({name: 'cirql-backend'});

/** Require configuration file */
var config = require('../config.json');
var fbBaseUrl = config.firebase;

function Netatmo(homeId, roomId, stationId, moduleId) {
  this.homeId = homeId;
  this.roomId = roomId;
  this.stationId = stationId;
  this.moduleId = moduleId;
  this.temperature = null;
};

Netatmo.prototype.bind = function(theRoom) {
	this.fbRefNetatmo =  new Firebase(fbBaseUrl+'homes/'+this.homeId+'/sensors/netatmo/stations/'+this.stationId+'/modules/'+this.moduleId+'/');
	log.info({home: this.homeId, room: this.roomId},'Netatmo FirebaseRef: '+this.fbRefNetatmo);
	// Optimization: Implement a check if new Temperature is different to old one
	this.fbRefNetatmo.child('temperature').on('value', function(fbNetatmoTemperature){
		if(fbNetatmoTemperature.val()) {
			this.temperature = fbNetatmoTemperature.val();
			theRoom.updateRoomTemperature();
		}
		else{
			log.warn({home: this.homeId, room: this.roomId, station: this.station, module: this.module }, 'Netatmo does not exist!');
		}
	},this);
};


Netatmo.prototype.getTemperature = function() {
	return this.temperature;
};

Netatmo.prototype.setFbRefOff = function() {
	this.fbRefNetatmo.child('temperature').off();
};

module.exports = Netatmo;
