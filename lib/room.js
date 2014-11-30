/**
 * Room class
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

var Netatmo = require('./netatmo.js');
var Heating = require('./heating.js');
var Thermostat = require('./thermostat.js');


/** Require configuration file */
var config = require('../config.json');
var fbBaseUrl = config.firebase;

function Room(homeId, roomId) {

    events.EventEmitter.call(this);
    this.id = roomId;
    this.homeId = homeId;
    this.thermostats = {};
    this.netatmo = null;
    this.temperature = null;
    this.realTarget = null;
    this.heating = null;
    this.hasThermostats = false;
    this.residentFbRefs = {};
    this.residentEtas = {};


    log.info({
        home: this.homeId,
        room: this.id
    }, ' Room: Initialized ');
    this.fbRef = new Firebase(fbBaseUrl + 'homes/' + this.homeId + '/rooms/' + this.id);

    /** Create And Delete Heating  if room has thermostats */
    this.fbRef.child('thermostats').on('value', function(fbThermostats) {
            if (fbThermostats.hasChildren()) {
                if (this.heating === null) {
                    log.info({
                        home: this.homeId,
                        room: this.id
                    }, ' Room: new Heating');
                    this.heating = new Heating(this.homeId, this.id);
                }
            } else {
                if (this.heating !== null) {
                    log.info({
                        home: this.homeId,
                        room: this.id
                    }, ' Room: delete Heating');
                    this.heating.setFbRefOff();
                    this.heating = null;
                }
            }
        },
        this
    );


    /** Create and Delete Thermostats if room has thermostats */
    /** Listen if thermostat is added to room **/
    this.fbRef.child('thermostats').on('child_added', function(fbThermostat) {
        this.hasThermostats = true;
        var thermostatId = fbThermostat.name();
        log.info({
            home: this.homeId,
            room: this.id
        }, ' Room: new Thermostat ' + thermostatId);
        this.thermostats[thermostatId] = new Thermostat(this.homeId, this.id, thermostatId);
        this.thermostats[thermostatId].bind(this);
    }, this);


    /** Listen if thermostat is removed from room */
    this.fbRef.child('thermostats').on('child_removed', function(fbThermostat) {
        var id = fbThermostat.name();
        var thermostatObj = this.thermostats[id];

        if (thermostatObj) {
            log.info({
                home: this.homeId,
                room: this.id
            }, ' Room: delete Thermostat with id: ' + id);
            thermostatObj.setFbRefOff();
            delete this.thermostats[id];
        }

        if (Object.keys(this.thermostats).length === 0) {
            this.hasThermostats = false;
        }
    }, this);

    /**
     * Listen for realTarget changes and set thermostat targets
     */
    this.fbRef.child('realTarget').on('value', function(fbRealTarget) {
        this.realTarget = fbRealTarget.val();
        for (var id in this.thermostats) {
            this.thermostats[id].setTarget(this.realTarget);
            log.info({
                home: this.homeId,
                room: this.id
            }, ' Room: Set target of  Thermostat ' + id + ' to ' + this.realTarget);
        }
    }, this);

    /** Listen if netatmo sensor is added to room **/
    this.fbRef.child('sensors').on('child_added', function(fbSensor) {
        if (fbSensor.name() === 'netatmo') {
            if ((fbSensor.hasChild('station')) && (fbSensor.hasChild('module'))) {
                var station = fbSensor.child('station').val();
                var module = fbSensor.child('module').val();
                log.info({
                    home: this.homeId,
                    room: this.id
                }, ' Room: new Netatmo ');
                this.netatmo = new Netatmo(this.homeId, this.id, station, module);
                this.netatmo.bind(this);
                /** Tell home that a netatmo module was added to the room
          /*  Home will start data getting
          /**/
                var self = this;
                setImmediate(function() {
                    self.emit('netatmoModuleAdded', {
                        stationId: station,
                        moduleId: module
                    });
                });
            }
        }
    }, this);

    /** Listen if netatmo sensor is removed from room **/
    this.fbRef.child('sensors').on('child_removed', function(fbSensor) {
        if (fbSensor.name() === 'netatmo') {
            if (this.netatmo !== null) {
                var station = fbSensor.child('station').val();
                var module = fbSensor.child('module').val();
                log.info({
                    home: this.homeId,
                    room: this.id
                }, ' Room: delete Netatmo');
                this.netatmo.setFbRefOff();
                this.netatmo = null;
                /** Tell home that a netatmo module was added to the room
          /*  Home will start data getting
          /**/
                var self = this;
                setImmediate(function() {
                    self.emit('netatmoModuleDeleted', {
                        stationId: station,
                        moduleId: module
                    });
                });
            }
        }
    }, this);

    /** Set target temperature accordingly **/
    this.fbRef.child('realTarget').on('value', function(fbRealTarget) {
        if (fbRealTarget.val()) {
            if (fbRealTarget.val() !== this.realTarget) {
                this.realTarget = fbRealTarget.val();
                if (this.hasThermostats) {
                    log.info({
                        home: this.homeId,
                        room: this.id
                    }, ' Room: set new target of ' + fbRealTarget.val() + ' ');
                    for (var thermostatKey in this.thermostats) {
                        var thermostat = this.thermostats[thermostatKey];
                        thermostat.setTarget(fbRealTarget.val());
                    }
                }
            }
        }
    }, this);

    this.fbRef.child('residents').on('child_added', function(fbResident) {
        var residentId = fbResident.name();
        log.info({
            home: this.homeId,
            room: this.id
        }, ' Room: Resident with id ' + residentId + ' is added ');
        var fbRefResident = new Firebase(fbBaseUrl + 'homes/' + this.homeId + '/residents/' + residentId);
        this.residentFbRefs[residentId] = fbRefResident;
        fbRefResident.child('allowsGeolocation').on('value', function(fbAllowGeo) {
            if (fbAllowGeo.val()) {
                fbRefResident.child('etaValue').on('value', function(fbEta) {
                    if (fbEta) {
                        this.residentEtas[residentId] = fbEta.val();
                        log.info({
                            home: this.homeId,
                            room: this.id
                        }, ' Room: Resident with id ' + residentId + ' has new ETA ' + fbEta.val());
                        this.calcMinEta();
                    }
                }, this);
            } else {
                fbRefResident.child('etaValue').off();
                delete this.residentEtas[residentId];
                this.calcMinEta();
            }
        }, this);
    }, this);

    this.fbRef.child('residents').on('child_removed', function(fbResident) {
        var residentId = fbResident.name();
        log.info({
            home: this.homeId,
            room: this.id
        }, ' Room: Resident with id ' + residentId + ' is deleted ');
        console.log('Delete ref to residentId: ' + residentId);
        this.residentFbRefs[residentId].child('allowsGeolocation').off();
        this.residentFbRefs[residentId].child('etaValue').off();
        this.residentFbRefs[residentId].off();
        delete this.residentFbRefs[residentId];
    }, this);

}

util.inherits(Room, events.EventEmitter);

Room.prototype.calcMinEta = function() {
    var minEta = 60 * 60 * 24 * 7;
    for (var residentKey in this.residentEtas) {
        var currentEta = this.residentEtas[residentKey];
        if (currentEta < minEta) {
            minEta = currentEta;
        }
    }
    console.log('MinEta is ' + minEta);
    this.fbRef.child('eta').set(minEta);
};


Room.prototype.calcAvgThermostatTemperature = function() {
    var avgTemp = 0.0;
    var sum = 0.0;
    var count = 0;
    for (var thermostatKey in this.thermostats) {
        var thermostat = this.thermostats[thermostatKey];
        sum += parseFloat(thermostat.getTemperature());
        count++;
    }
    avgTemp = Math.round(sum / count * 10) / 10;
    return avgTemp;
};

Room.prototype.updateRoomTemperature = function() {

  var netatmoUpToDate;


    if (this.netatmo !== null) {

        netatmoUpToDate = ((Date.now() - (this.netatmo.getTimestamp() - 5000)) < 20 * 60 * 1000) ? true : false;

    } else {

        netatmoUpToDate = false;

    }


    if (this.netatmo !== null && this.netatmo.getTemperature() !== null && netatmoUpToDate) {
        if (this.temperature !== this.netatmo.getTemperature()) {
            this.temperature = this.netatmo.getTemperature();
            //console.log(this.temperature +  ' !== '  + this.netatmo.getTemperature());
            this.fbRef.child('temperature').set(this.netatmo.getTemperature());
            log.info({
                home: this.homeId,
                room: this.id
            }, ' Room: new temperature of ' + this.netatmo.getTemperature() + ' is set by netatmo');

            // Update external temperature of thermostats
            if (this.hasThermostats) {
                log.info({
                    home: this.homeId,
                    room: this.id
                }, ' Room: Update external temperature of ' + this.netatmo.getTemperature());

                for (var thermostatKey in this.thermostats) {
                    var thermostat = this.thermostats[thermostatKey];
                    thermostat.setExternalTemperature({
                        'timestamp': this.netatmo.getTimestamp(),
                        'value': this.netatmo.getTemperature()
                    });
                }
            }
        }


    } else if (Object.keys(this.thermostats).length !== 0) {
        var avgTemp = this.calcAvgThermostatTemperature();
        if (this.temperature !== avgTemp) {
            this.temperature = avgTemp;
            //console.log(this.temperature +  ' !== '  + avgTemp);
            this.fbRef.child('temperature').set(avgTemp);
            log.info({
                home: this.homeId,
                room: this.id
            }, ' Room: new temperature ' + avgTemp + ' is set by thermostats');
        }
    } else {
        log.warn({
            home: this.homeId,
            room: this.id
        }, ' Room: No temperature measurement since  netatmo or thermostats are not available');
    }
};

Room.prototype.updateManualChange = function(isManualChange, targetTemperature) {
    this.fbRef.child('manualSetpointChange').set(isManualChange);
    if (isManualChange) {
        this.heating.reactToManualChange(targetTemperature);
    }
};

Room.prototype.setFbRefOff = function() {
    this.fbRef.off();
    log.info({
        home: this.homeId,
        room: this.id
    }, ' Room: All fbRefs are set to off');
};


module.exports = Room;