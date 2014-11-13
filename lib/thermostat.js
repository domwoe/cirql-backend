/**
 * Thermostat class
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

function Thermostat(homeId, roomId, thermostatId) {
  this.homeId = homeId;
  this.roomId = roomId;
  this.thermostatId = thermostatId;
  this.temperature = null;

  this.fbRefThermostat =  new Firebase(fbBaseUrl+'homes/'+this.homeId+'/thermostats/'+this.thermostatId+'/');
  log.info({home: this.homeId, room: this.roomId, thermostat: thermostatId}, 'Thermostat FirebaseRef: '+this.fbRefThermostat);

}

Thermostat.prototype.bind = function(theRoom) {
	this.fbRefThermostat.child('temperature').on('value', function(fbThermostatTemperature){
  	if(fbThermostatTemperature.val()){
		this.temperature = fbThermostatTemperature.val();
		theRoom.updateRoomTemperature();
	}
	else {
		  log.warn({home: this.homeId, room: this.roomId, thermostat: this.thermostatId}, 'Thermostat: Thermostat does not exist!');
	}
   },
   this);
};

Thermostat.prototype.getTemperature = function() {
	return this.temperature;
};

Thermostat.prototype.setTarget = function(target) {
	this.fbRefThermostat.child('target').set(target);
};

Thermostat.prototype.setFbRefOff = function() {
	this.fbRefThermostat.child('temperature').off();
};

module.exports = Thermostat;
