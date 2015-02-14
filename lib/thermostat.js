/**
 * Thermostat class
 *
 */

/*jslint node: true */
'use strict';

var events = require('events');
var util = require('util');

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

var storage = require('./storage.js');

function Thermostat(homeId, roomId, thermostatId) {

    events.EventEmitter.call(this);

    this.homeId = homeId;
    this.roomId = roomId;
    this.thermostatId = thermostatId;
    this.manualChange = false;
    this.temperature = null;
    this.valve = null;
    this.fhemTargetTemperature = null;
    this.fbRefThermostat = new Firebase(fbBaseUrl + 'homes/' + this.homeId + '/thermostats/' + this.thermostatId + '/');
    //this.fbRefProblems = new Firebase (fbBaseUrl+'/problems/');
    //this.fbRefConflict = null;
    this.conflictTimer = null;
    this.saveTimeout = null;
    this.oldTemperature = null;
    this.usesExternalTemp = null;
    this.externalTemperature = null;

    this.fbRefThermostat.child('target').on('value', function(fbThermostatSetpoint) {
        if (fbThermostatSetpoint.val()) {

            this.targetTemperature = fbThermostatSetpoint.val();

            this.testForConflict(parseFloat(this.targetTemperature), parseFloat(this.fhemTargetTemperature));
        } else {

            log.warn({
                home: this.homeId,
                room: this.roomId,
                thermostat: this.thermostatId
            }, 'Thermostat target could not be retrieved from Firebase');


        }

    }, this);

    this.fbRefThermostat.child('usesExternalTemp').on('value', function(fbUsesExtTemp) {

        this.usesExternalTemp = fbUsesExtTemp.val();

    }, this);

    this.fbRefThermostat.child('room').on('value', function(fbRoom) {

        if (fbRoom.val()) {

            if (fbRoom.val() !== this.roomId) {

                log.warn({
                    home: this.homeId,
                    room: this.roomId,
                    thermostat: this.thermostatId
                }, 'RoomIds do not match! From Firebase: ' + fbRoom.val());

            }

        } else {

            log.warn({
                home: this.homeId,
                room: this.roomId,
                thermostat: this.thermostatId
            }, 'RoomId could not be retrieved from Firebase');
        }

    }, this);

    this.fbRefThermostat.child('fhem_desired-temp').on('value', function(fbThermostatSetpoint) {
        if (this.fhemTargetTemperature !== null && this.fhemTargetTemperature !== fbThermostatSetpoint.val()) {
            this.save('target', fbThermostatSetpoint.val());
        }
        this.fhemTargetTemperature = fbThermostatSetpoint.val();
        var self = this;
        setImmediate(function() {
            self.emit('newThermostatTarget', {
                roomId: self.roomId,
                target: self.fhemTargetTemperature
            });
        });

        this.testForConflict(parseFloat(this.targetTemperature), parseFloat(this.fhemTargetTemperature));

        // Probably window open mode. Report problem b
        if (parseFloat(this.fhemTargetTemperature) === 12) {
            // var date = new Date();
            // var problem = {
            //  home: this.homeId,
            //  room: this.roomId,
            //  thermostat: this.thermostatId,
            //  date: date,
            //  problem: 'fhem_desired-temp = 12. Probably window open mode on'
            // };

            // log.warn({
            //     home: this.homeId,
            //     room: this.roomId,
            //     thermostat: this.thermostatId
            // }, 'WINDOW OPEN WARNING: fhem_desired-temp = 12');
            // this.fbRefProblems.push(problem);
            // dddd
        }
    }, this);


}

util.inherits(Thermostat, events.EventEmitter);

Thermostat.prototype.save = function(type, value) {
    // console.log('--------------------------------');
    // console.log('INSIDE SAVE');
    // console.log('TYPE: ' + type);
    // console.log('VALUE: ' + value);
    // console.log('--------------------------------');
    var obj = {
        table: 'thermostats',
        data: {
            homeid: this.homeId,
            roomid: this.roomId,
            thermostatid: this.thermostatId,
            type: type,
            value: value,
        }
    };
    storage.save(obj);

};

Thermostat.prototype.bind = function(theRoom) {
    this.fbRefThermostat.child('fhem_measured-temp').on('value', function(fbThermostatTemperature) {
            // console.log('--------------------------------');
            // console.log('NEW FHEM MEASURED TEMP');
            if (fbThermostatTemperature.val()) {
                if (this.temperature !== null && this.temperature !== fbThermostatTemperature.val()) {
                    this.save('temperature', fbThermostatTemperature.val());
                    //console.log('SAVING');
                    //console.log('--------------------------------');

                    if (Math.abs(fbThermostatTemperature.val() - this.temperature) > 1) {

                        log.warn({
                            home: this.homeId,
                            room: this.roomId,
                            thermostat: this.thermostatId
                        }, 'Significant change in measured temperature:\nNew Temperature: ' + fbThermostatTemperature.val() + '\nOld Temperature: ' + this.temperature);

                    }

                    if (this.oldTemperature && Math.abs(this.oldTemperature - this.temperature) > 0.2 && fbThermostatTemperature.val() === this.oldTemperature) {

                        log.warn({
                            home: this.homeId,
                            room: this.roomId,
                            thermostat: this.thermostatId
                        }, 'Spike in measured temperature:\nNew Temperature: ' + fbThermostatTemperature.val() + '\nOld Temperature: ' + this.temperature);

                    }

                }
                this.oldTemperature = this.temperature;
                this.temperature = fbThermostatTemperature.val();
                theRoom.updateRoomTemperature();

                if (this.usesExternalTemp && Math.abs(this.temperature - this.externalTemperature > 0.2)) {

                    log.warn({
                        home: this.homeId,
                        room: this.roomId,
                        thermostat: this.thermostatId
                    }, 'Thermostat external temperature warning: Thermostat should use external temperature (' + this.externalTemperature + ') but reports ' + this.temperature);

                }
            } else {
                log.warn({
                    home: this.homeId,
                    room: this.roomId,
                    thermostat: this.thermostatId
                }, 'Thermostat: fhem_measured-temp could not be found with url: ' + this.fbRefThermostat.child('fhem_measured-temp').ref());
            }
        },
        this);

    this.fbRefThermostat.child('fhem_actuator').on('value', function(fbThermostatValve) {
            // console.log('--------------------------------');
            // console.log('NEW FHEM VALVE');
            if (fbThermostatValve.val()) {
                if (this.valve !== null && this.valve !== fbThermostatValve.val()) {
                    this.save('valve', fbThermostatValve.val());
                    // console.log('SAVING');
                    // console.log('--------------------------------');
                }
                this.valve = fbThermostatValve.val();
                theRoom.updateRoomAvgThermostatValve();
            } else {
                log.warn({
                    home: this.homeId,
                    room: this.roomId,
                    thermostat: this.thermostatId
                }, 'Thermostat: fhem_actuator could not be found with url: ' + this.fbRefThermostat.child('fhem_actuator').ref());
            }
        },
        this);

    this.fbRefThermostat.child('manualChange').on('value', function(fbThermostatManualChange) {
        if (fbThermostatManualChange) {
            if (fbThermostatManualChange.val() === true) {
                this.manualChange = fbThermostatManualChange.val();
                theRoom.updateManualChange(fbThermostatManualChange.val(), this.targetTemperature);
                this.fbRefThermostat.child('manualChange').set(false);
                log.info({
                    home: this.homeId,
                    room: this.roomId,
                    thermostat: this.thermostatId
                }, 'Thermostat: manualChange: ' + fbThermostatManualChange.val());
            }
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

Thermostat.prototype.getValve = function() {
    return this.valve;
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

        this.externalTemperature = obj.value;

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
            //      var problem = {
            //          home: this.homeId,
            //          room: this.roomId,
            //          thermostat: this.thermostatId,
            //          date: date,
            //          problem: 'fhem_desired-temp !== thermostat target'
            //      };
            //      var self = this;
            //      this.fbRefProblems.push(problem, function(fbRefConflict) {
            //          self.fbRefConflict = fbRefConflict;
            //      });

            log.info({
                home: self.homeId,
                room: self.roomId,
                thermostat: self.thermostatId
            }, 'WARNING: fhem_desired-temp (' + fhemTarget + ') !== thermostat target  (' + target + ')');

        }, 5 * 60 * 1000);

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