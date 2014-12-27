/**
 * Thermostat class
 *
 */

/*jslint node: true */
'use strict';

var Firebase = require('firebase');
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

/** Require configuration file */
var config = require('../config.json');
var fbBaseUrl = config.firebase;

function Thermostat(homeId, roomId, thermostatId) {
    this.homeId = homeId;
    this.roomId = roomId;
    this.thermostatId = thermostatId;
    this.manualChange = false;
    this.temperature = null;

    this.fbRefThermostat = new Firebase(fbBaseUrl + 'homes/' + this.homeId + '/thermostats/' + this.thermostatId + '/');
    //this.fbRefProblems = new Firebase (fbBaseUrl+'/problems/');
    //this.fbRefConflict = null;
    this.conflictTimer = null;

    this.fbRefThermostat.child('target').on('value', function(fbThermostatSetpoint) {
        this.targetTemperature = fbThermostatSetpoint.val();

        this.testForConflict(parseFloat(this.targetTemperature), parseFloat(this.fhemTargetTemperature));

    }, this);

    this.fbRefThermostat.child('fhem_desired-temp').on('value', function(fbThermostatSetpoint) {
        this.fhemTargetTemperature = fbThermostatSetpoint.val();

        this.testForConflict(parseFloat(this.targetTemperature), parseFloat(this.fhemTargetTemperature));

        // Probably window open mode. Report problem
        if (parseFloat(this.fhemTargetTemperature) === 12) {
            // var date = new Date();
            // var problem = {
            // 	home: this.homeId,
            // 	room: this.roomId,
            // 	thermostat: this.thermostatId,
            // 	date: date,
            // 	problem: 'fhem_desired-temp = 12. Probably window open mode on'
            // };

            log.info({
                home: this.homeId,
                room: this.roomId,
                thermostat: this.thermostatId
            }, 'WARNING: fhem_desired-temp = 12. windowOpnMode');
            //this.fbRefProblems.push(problem);
        }
    }, this);


}

Thermostat.prototype.bind = function(theRoom) {
    this.fbRefThermostat.child('fhem_measured-temp').on('value', function(fbThermostatTemperature) {
            if (fbThermostatTemperature.val()) {

                this.temperature = fbThermostatTemperature.val();
                theRoom.updateRoomTemperature();
            } else {
                log.warn({
                    home: this.homeId,
                    room: this.roomId,
                    thermostat: this.thermostatId
                }, 'Thermostat: fhem_measured-temp could not be found with url: ' + this.fbRefThermostat.child('commandAccepted').child('fhem_measured-temp').ref());
            }
        },
        this);

    this.fbRefThermostat.child('manualChange').on('value', function(fbThermostatManualChange) {
        if (fbThermostatManualChange) {
            this.manualChange = fbThermostatManualChange.val();
            theRoom.updateManualChange(fbThermostatManualChange.val(), this.targetTemperature);
            log.info({
                home: this.homeId,
                room: this.roomId,
                thermostat: this.thermostatId
            }, 'Thermostat: manualChange: ' + fbThermostatManualChange.val());
        } else {
            log.warn({
                home: this.homeId,
                room: this.roomId,
                thermostat: this.thermostatId
            }, 'Thermostat: manualChange could not be found');
        }
    }, this);
};

Thermostat.prototype.getTemperature = function() {
    return this.temperature;
};

Thermostat.prototype.setTarget = function(value) {
    if (value) {
        value = (value > 30) ? 30 : value;
        value = (value < 5) ? 5 : value;

        this.fbRefThermostat.child('target').set(value);
    } else {
        log.warn({
            home: this.homeId,
            room: this.roomId,
            thermostat: this.thermostatId
        }, 'Thermostat: Invalid target temperature for thermostat');
    }
};

Thermostat.prototype.setExternalTemperature = function(obj) {

    if (obj) {

        this.fbRefThermostat.child('externalTemperature').set(obj);
    } else {
        log.warn({
            home: this.homeId,
            room: this.roomId,
            thermostat: this.thermostatId
        }, 'Thermostat: Invalid external temperature object');
    }
};

Thermostat.prototype.testForConflict = function(target, fhemTarget) {
    if (target !== fhemTarget) {
        var self = this;
        if (this.conflictTimer) {
            clearTimeout(this.conflictTimer);
        }
        this.conflictTimer = setTimeout(function() {
                // var date = new Date();
                // 		var problem = {
                // 			home: this.homeId,
                // 			room: this.roomId,
                // 			thermostat: this.thermostatId,
                // 			date: date,
                // 			problem: 'fhem_desired-temp !== thermostat target'
                // 		};
                // 		var self = this;
                // 		this.fbRefProblems.push(problem, function(fbRefConflict) {
                // 			self.fbRefConflict = fbRefConflict;
                // 		});

                log.info({
                        home: self.homeId,
                        room: self.roomId,
                        thermostat: self.thermostatId
                    }, 'WARNING: fhem_desired-temp (' + fhemTarget + ') !== thermostat target  (' + target + ')');

		}, 5*60*1000);

	} else {

		if (this.conflictTimer) {
			clearTimeout(this.conflictTimer);
		}	

	}

};

Thermostat.prototype.setFbRefOff = function() {
	this.fbRefThermostat.child('fhem_measured-temp').off();
	this.fbRefThermostat.child('target').off();
	this.fbRefThermostat.child('fhem_desired-temp').off();
};

module.exports = Thermostat;