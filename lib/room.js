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

var notifications = require('./notifications.js');
var helper = require('./helperFuncs.js');
var Netatmo = require('./netatmo.js');
var Heating = require('./heating.js');
var Thermostat = require('./thermostat.js');
var MaxThermostat = require('./maxThermostat.js');
var Roomclimate = require('./roomclimate.js');
var Activity = require('./activity.js');
var storage = require('./storage.js');
var History = require('./history.js');



/** Require configuration file */
var config = require('../config.json');
var fbBaseUrl = config.firebase;

function Room(homeId, roomId, home) {

    events.EventEmitter.call(this);
    this.id = roomId;
    this.roomName = '';
    this.homeId = homeId;
    this.home = home;
    this.thermostats = {};
    this.maxThermostats = {};
    this.netatmo = null;
    this.roomclimate = null;
    this.activity = null;
    this.temperature = null;
    this.realTarget = null;
    this.heating = null;
    this.hasThermostats = false;
    this.hasMaxThermostats = false;
    this.residentEtas = {};
    this.residentAways = {};
    this.category = null;
    this.valve = null;
    this.hasNetatmo = null;
    this.notifyResidents = null;
    this.msg = null;
    this.CO2AlertIsSent = false;

    this.history = new History(this.homeId, this.id);

    log.info({
        home: this.homeId,
        room: this.id
    }, ' Room: Initialized ');
    this.fbRef = new Firebase(fbBaseUrl + 'homes/' + this.homeId + '/rooms/' + this.id);
    this.fbRefActivity = new Firebase(fbBaseUrl + 'homes/' + this.homeId + '/activity/');
    this.fbRefResidents = new Firebase(fbBaseUrl + 'homes/' + this.homeId + '/residents/');
    this.fbRefTemplates = new Firebase(fbBaseUrl + 'templates/');

    this.fbRefActivity.on('child_added', function(fbRawLog) {
        if (fbRawLog.key()) {
            var id = fbRawLog.key();
            if (id === this.id) {
                if (this.activity === null) {
                    this.activity = new Activity(this.homeId, this.id);
                    log.info({
                        home: this.homeId,
                        room: this.id,
                        activity: this.id
                    }, ' Room: Activity Log for room created');
                }
            }
        }
    }, this);

    //Init virtualTarget for better UI
    this.fbRef.child('virtualTarget').once('value', function(fbVirtualTarget) {
        if (!fbVirtualTarget.val()) {
            this.fbRef.child('virtualTarget').set(21);
        }
    }, this);

    this.fbRef.child('name').on('value', function(fbRoomName) {
        if (fbRoomName.val() !== null) {
            this.roomName = fbRoomName.val();
        }
    }, this);

    this.fbRef.child('msg').on('value', function(fbMsgs) {
        if (fbMsgs.val() !== null) {
            this.msg = fbMsgs.val();
        }
    }, this);

    this.fbRef.child('notifications').once('value', function(fbNoti) {
        this.fbRefResidents.once('value', function(fbResidents) {
            if (fbResidents.val() !== null) {
                for (var fbResiKey in fbResidents.val()) {
                    if (fbNoti.val() === null) {
                        this.fbRef.child('notifications').child(fbResiKey).set(true);
                    } else {
                        var isFound = false;
                        for (var fbNotiKey in fbNoti.val()) {
                            if (fbNotiKey === fbResiKey) {
                                isFound = true;
                            }
                        }
                        if (isFound === false) {
                            this.fbRef.child('notifications').child(fbResiKey).set(false);
                        }
                    }
                }
            }
        }, this);
    }, this);

    this.fbRef.child('category').on('value', function(fbCat) {
        if (fbCat.val()) {
            this.category = fbCat.val();
            this.fbRef.child('schedule').once('value', function(fbScheduleData) {
                if (fbScheduleData.val() === null) {
                    this.fbRefTemplates.child(this.category).child('schedule').once('value', function(fbTemplateData) {
                        if (fbTemplateData.val() !== null) {

                            for (var scheduleEventKey in fbTemplateData.val()) {
                                var scheduleEvent = fbTemplateData.val()[scheduleEventKey];
                                this.fbRef.child('schedule').push(scheduleEvent);
                            }
                            log.info({
                                home: this.homeId,
                                room: this.id
                            }, ' Room: Schedule generated according to ' + this.category + ' template');
                        }
                    }, this);

                }
            }, this);
        }
    }, this);


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
        var thermostatId = fbThermostat.key();
        log.info({
            home: this.homeId,
            room: this.id
        }, ' Room: new Thermostat ' + thermostatId);
        this.thermostats[thermostatId] = new Thermostat(this.homeId, this.id, thermostatId);
        this.thermostats[thermostatId].bind(this);
    }, this);


    /** Listen if thermostat is removed from room */
    this.fbRef.child('thermostats').on('child_removed', function(fbThermostat) {
        var id = fbThermostat.key();
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


    /*
     * Nefit and MAX s Thermostasts
     */
    this.fbRef.child('maxThermostats').on('child_added', function(fbThermostat) {
        if (this.heating === null) {
            log.info({
                home: this.homeId,
                room: this.id
            }, ' Room: new Heating');
            this.heating = new Heating(this.homeId, this.id);
        }
        this.hasMaxThermostats = true;
        var thermostatId = fbThermostat.key();
        log.info({
            home: this.homeId,
            room: this.id
        }, ' Room: new MaxThermostat ' + thermostatId);
        var nefit = this.home.getNefit();
        this.maxThermostats[thermostatId] = new MaxThermostat(this.homeId, this.id, thermostatId, nefit);

    }, this);


    this.fbRef.child('maxThermostats').on('child_removed', function(fbThermostat) {
        var id = fbThermostat.key();
        var thermostatObj = this.maxThermostats[id];

        if (thermostatObj) {
            log.info({
                home: this.homeId,
                room: this.id
            }, ' Room: delete MaxThermostat with id: ' + id);
            thermostatObj.setFbRefOff();
            delete this.maxThermostats[id];
        }

        if (Object.keys(this.maxThermostats).length === 0) {
            this.hasMaxThermostats = false;
            if (this.heating !== null) {
                log.info({
                    home: this.homeId,
                    room: this.id
                }, ' Room: delete Heating');
                this.heating.setFbRefOff();
                this.heating = null;
            }

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
            //Save to DB
            var obj = {
                table: 'measurements',
                data: {
                    homeid: this.homeId,
                    roomid: this.id,
                    value: this.realTarget,
                    type: 'target',
                }
            };
            storage.save(obj);
            this.history.save('target', this.realTarget);
        }
        for (var maxId in this.maxThermostats) {

            log.info({
                home: this.homeId,
                room: maxId
            }, ' Room: Set target of  MaxThermostat ' + maxId + ' to ' + this.realTarget);
            this.maxThermostats[maxId].setTarget(this.realTarget);

        }
    }, this);

    /** Listen if netatmo sensor is added to room **/
    this.fbRef.child('sensors').on('child_added', function(fbSensor) {

        if (fbSensor.key() === 'netatmo') {
            if ((fbSensor.hasChild('station')) && (fbSensor.hasChild('module'))) {
                this.hasNetatmo = true;
                var station = fbSensor.child('station').val();
                var module = fbSensor.child('module').val();
                log.info({
                    home: this.homeId,
                    room: this.id
                }, ' Room: new Netatmo ');
                this.netatmo = new Netatmo(this.homeId, this.id, station, module);
                this.netatmo.bind(this);
                this.roomclimate = new Roomclimate(this.homeId, this.id);
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
            } else {
                this.hasNetatmo = false;
            }
        } else {
            this.hasNetatmo = false;
        }
    }, this);

    /** Listen if netatmo  sensor is removed from room **/
    this.fbRef.child('sensors').on('child_removed', function(fbSensor) {
        if (fbSensor.key() === 'netatmo') {
            if (this.netatmo !== null) {
                var station = fbSensor.child('station').val();
                var module = fbSensor.child('module').val();
                log.info({
                    home: this.homeId,
                    room: this.id
                }, ' Room: delete Netatmo');
                this.netatmo.setFbRefOff();
                this.netatmo = null;
                this.roomclimate.setFbRefOff();
                this.roomclimate = null;
                this.fbRef.child('co2').set(null);
                this.fbRef.child('humidity').set(null);
                this.fbRef.child('netatmoUpToDate').set(null);
                this.fbRef.child('usesExternalTemperature').set(false);
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
            } else {
                this.hasNetatmo = false;
            }
        } else {
            this.hasNetatmo = false;
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

    this.fbRef.child("notifications").on("value", function(residentSnap) {
        if (residentSnap.val() !== null) {
            this.notifyResidents = residentSnap.val();
            log.info({
                home: this.homeId,
                room: this.roomId
            }, " Roomclimate-Analytics: Residents for Notifications changed to " + JSON.stringify(this.notifyResidents));
        }
    }, this);

    //test test
    this.fbRef.child('usesAutoAway').on('value', function(fbAutoAway) {
        if (fbAutoAway.val()) {
            if (fbAutoAway.val() === true) {
                this.fbRef.child('residentStates').on('value',
                    function(fbResidentStates) {
                        if (fbResidentStates.val()) {
                            var resStates = fbResidentStates.val();
                            var minEta = 60 * 60 * 24 * 7;
                            var etaHasChanged = false;
                            var isAway = true;
                            var isAwayHasChanged = false;
                            for (var residentKey in resStates) {
                                var resident = resStates[residentKey];
                                if (resident.allowsGeo === true) {
                                    if (resident.eta !== null) {
                                        if (resident.eta < minEta) {
                                            etaHasChanged = true;
                                            minEta = resident.eta;
                                        }
                                    }
                                    if (resident.isAway !== null) {
                                        isAwayHasChanged = true;
                                        if (resident.isAway === false) {
                                            isAway = resident.isAway;
                                        }
                                    }
                                }
                            }
                            if (etaHasChanged) {
                                this.fbRef.child('eta').set(minEta);
                                log.info({
                                    home: this.homeId,
                                    room: this.id
                                }, ' Room: The Min-ETA of the room is now: ' + minEta);
                            } else {
                                log.info({
                                    home: this.homeId,
                                    room: this.id
                                }, ' Room: No min eta could be computed ');
                            }
                            if (isAwayHasChanged) {
                                this.fbRef.child('isAway').set(isAway);
                                log.info({
                                    home: this.homeId,
                                    room: this.id
                                }, ' Room: The Away-State of the room is now: ' + isAway);
                            } else {
                                log.info({
                                    home: this.homeId,
                                    room: this.id
                                }, ' Room: There are no residents for computing isAway State thus we set isAway and usesAutoAway to false');
                                this.fbRef.child('isAway').set(false);
                                this.fbRef.child('usesAutoAway').set(false);
                            }
                        }
                    }, this);
            } else if (fbAutoAway.val() === false) {
                log.info({
                    home: this.homeId,
                    room: this.id
                }, ' Room: AutoAway of room is deactivated. We set fbRef to residentStates to off!');
                this.fbRef.child('residentStates').off('value');
            }
        }
    }, this);
}

util.inherits(Room, events.EventEmitter);


Room.prototype.calcAvgThermostatTemperature = function() {
    var avgTemp = 0.0;
    var sum = 0.0;
    var count = 0;
    for (var thermostatKey in this.thermostats) {
        var thermostat = this.thermostats[thermostatKey];
        var temp = parseFloat(thermostat.getTemperature());
        if (temp !== null && !isNaN(temp)) {
            sum += parseFloat(thermostat.getTemperature());
            count++;
        } else {
            log.warn({
                home: this.homeId,
                room: this.id
            }, ' Room: Temperature of thermostat ' + thermostatKey + ' is not valid since it is ' + temp);
        }
    }
    if (count > 0) {
        avgTemp = Math.round(sum / count * 10) / 10;
    } else {
        log.warn({
            home: this.homeId,
            room: this.id
        }, ' Room: No valid temperature values at thermostats found!!! ');
    }
    return avgTemp;
};



Room.prototype.updateRoomTemperature = function() {

    if (this.hasNetatmo !== null) { // Netatmo flag is set!

        var useThermostatsTemperature = false; // Init to false only for safety

        if (this.hasNetatmo === true) { //there is a netatmo
            if (this.netatmo.getTimestamp !== null) { // netatmo is ready
                var netatmoTimestamp = this.netatmo.getTimestamp();
                if ((Date.now() - netatmoTimestamp) < 30 * 60 * 1000) { // netatmo is uptodate
                    useThermostatsTemperature = false;
                    this.fbRef.child('netatmoUpToDate').set(true);
                    this.fbRef.child('usesExternalTemperature').set(true);

                    // Update temperature in room
                    if (this.temperature !== this.netatmo.getTemperature()) {
                        log.info({
                            home: this.homeId,
                            room: this.id
                        }, ' Room: new temperature of ' + this.netatmo.getTemperature() + ' is set by Netatmo');
                    }
                    this.temperature = this.netatmo.getTemperature();
                    this.fbRef.child('temperature').set(this.netatmo.getTemperature());

                    // Update temperature in thermostats
                    if (this.hasThermostats === true) {
                        for (var thermostatKey in this.thermostats) {
                            var thermostat = this.thermostats[thermostatKey];
                            thermostat.setExternalTemperature({
                                'timestamp': netatmoTimestamp,
                                'value': this.netatmo.getTemperature()
                            });
                        }
                    }

                    // Update temperature in MaxThermostats
                    if (this.hasMaxThermostats === true) {
                        for (var maxThermostatKey in this.maxThermostats) {
                            var maxThermostat = this.maxThermostats[maxThermostatKey];
                            maxThermostat.setTemperature(this.temperature);
                        }
                    }

                    //Save to DB
                    var obj1 = {
                        table: 'measurements',
                        data: {
                            homeid: this.homeId,
                            roomid: this.id,
                            value: this.netatmo.getTemperature(),
                            type: 'temperature',
                            timestamp: netatmoTimestamp,
                            date: new Date(netatmoTimestamp)
                        }
                    };
                    storage.save(obj1);
                    this.history.save('temperature', this.netatmo.getTemperature());


                } else { // Netatmo is not uptodate --> use thermostats temperature
                    useThermostatsTemperature = true;
                    this.fbRef.child('netatmoUpToDate').set(false);

                    log.info({
                        home: this.homeId,
                        room: this.id
                    }, 'Room: Netatmo is not up-to-date!');
                }

                // Log LastExternalSensorUpdate
                var netatmoDateString = new Date(netatmoTimestamp);
                netatmoDateString = netatmoDateString + '';
                this.fbRef.child('lastExternalSensorUpdate').set(netatmoDateString);

            } else { // Netatmo is not ready -->  Wait for new measurements
                useThermostatsTemperature = false;
                log.info({
                    home: this.homeId,
                    room: this.id
                }, 'Room: Netatmo timestamp is not available');
            }
        } else { // Netatmo is not available -->  use thermostats temperature
            useThermostatsTemperature = true;
            log.info({
                home: this.homeId,
                room: this.id
            }, 'Room: There is no Netatmo station available');
        }

        if (useThermostatsTemperature === true) {
            if (this.hasThermostats) {
                var avgTemp = this.calcAvgThermostatTemperature();
                if (avgTemp !== 0.0) {
                    if (this.temperature !== avgTemp && !isNaN(avgTemp)) {
                        //Update temperature in room
                        if (this.temperature !== avgTemp) {
                            log.info({
                                home: this.homeId,
                                room: this.id
                            }, ' Room: new temperature ' + avgTemp + ' is set by thermostats');
                        }
                        this.temperature = avgTemp;

                        this.fbRef.child('temperature').set(avgTemp);
                        this.fbRef.child('usesExternalTemperature').set(false);

                        //Save to DB
                        var obj2 = {
                            table: 'measurements',
                            data: {
                                homeid: this.homeId,
                                roomid: this.id,
                                value: this.temperature,
                                type: 'temperature',
                            }
                        };
                        storage.save(obj2);
                        this.history.save('temperature', this.temperature);


                    }
                } else {
                    log.warn({
                        home: this.homeId,
                        room: this.id
                    }, ' Room: No thermostat temperature measurements found!');
                }
            }
        }
    }
};



Room.prototype.calcAvgThermostatValve = function() {
    var avgValve = 1000.0;
    var sum = 0.0;
    var count = 0;
    for (var thermostatKey in this.thermostats) {
        var thermostat = this.thermostats[thermostatKey];
        var valve = parseFloat(thermostat.getValve());
        if (valve !== null && !isNaN(valve)) {
            sum += parseFloat(thermostat.getValve());
            count++;
        } else {
            log.warn({
                home: this.homeId,
                room: this.id
            }, ' Room: Valve of thermostat ' + thermostatKey + ' is not valid since it is ' + valve);
        }
    }
    if (count > 0) {
        avgValve = Math.round(sum / count);
    } else {
        log.warn({
            home: this.homeId,
            room: this.id
        }, ' Room: No valid valve values at thermostats found!!! ');
    }
    return avgValve;
};


Room.prototype.updateRoomAvgThermostatValve = function() {
    if (Object.keys(this.thermostats).length !== 0) {
        var avgValve = this.calcAvgThermostatValve();
        if (avgValve !== 1000.0) {
            if (this.valve !== avgValve && !isNaN(avgValve) && avgValve !== null) {
                this.valve = avgValve;
                //console.log(this.temperature +  ' !== '  + avgTemp);
                this.fbRef.child('valve').set(avgValve);
                log.info({
                    home: this.homeId,
                    room: this.id
                }, ' Room: new avg valve ' + avgValve + ' is set ');

                //Save to DB
                var obj = {
                    table: 'measurements',
                    data: {
                        homeid: this.homeId,
                        roomid: this.id,
                        value: this.valve,
                        type: 'valve',
                    }
                };
                storage.save(obj);
                this.history.save('valve', this.valve);
            }
        } else {
            this.fbRef.child('valve').set('null');
            log.warn({
                home: this.homeId,
                room: this.id
            }, ' Room: No valve measurements found!');
        }
    } else {
        this.fbRef.child('valve').set('null');
        log.warn({
            home: this.homeId,
            room: this.id
        }, ' Room: No valve measurements since thermostats are not available');
    }
};

Room.prototype.updateCo2 = function(value) {
    if (value !== this.co2 && value !== null && value !== 'undefined') {

        this.co2 = value;
        this.fbRef.child('co2').set(value);
        log.info({
            home: this.homeId,
            room: this.id
        }, "Roomclimate-Analytics: UPDATE-CO2 is called");

        if (this.co2 > 1500) {
            if (this.CO2AlertIsSent === false) {
                this.CO2AlertIsSent = true;
                this.notifyAll();
            }
        } else {
            this.CO2AlertIsSent = false;
        }


        //Save to DB
        var timestamp = this.netatmo.getTimestamp();
        if (timestamp) {
            var obj = {
                table: 'measurements',
                data: {
                    homeid: this.homeId,
                    roomid: this.id,
                    timestamp: timestamp,
                    date: new Date(timestamp),
                    value: this.co2,
                    type: 'co2'
                }
            };
            storage.save(obj);
            this.history.save('co2', this.co2, timestamp);
        } else {
            log.warn({
                home: this.homeId,
                room: this.id
            }, "Didn't save co2 because netatmo timestamp is " + timestamp);
        }
    }
};

Room.prototype.notifyAll = function() {
    log.info({
        home: this.homeId,
        room: this.id
    }, " Roomclimate-Analytics: NotifyAll tiggered");
    for (var key in this.notifyResidents) {
        var wantsNotifications = this.notifyResidents[key];
        log.info({
            home: this.homeId,
            room: this.id
        }, " Roomclimate-Analytics: Check resident with key " + key + " and wantsNoti " + wantsNotifications);
        if (wantsNotifications === true) {
            this.fbRef.child('residentStates').child(key).once('value', function(fbResidentState) {
                log.info({
                    home: this.homeId,
                    room: this.id
                }, " Roomclimate-Analytics: Check residentSTates");
                var doNotNotifyBecauseIsAway = false;
                // if (fbResidentState.val() !== null) {
                //     var residentState = fbResidentState.val();
                //     if (residentState.allowsGeo === true && residentState.isAway === true) {
                //         doNotNotifyBecauseIsAway = true;
                //     }
                // }
                if (doNotNotifyBecauseIsAway === false) {
                    this.fbRefResidents.child(key).child("notification").child("devices").once('value', function(devicesSnap) {
                        log.info({
                            home: this.homeId,
                            room: this.id
                        }, " Roomclimate-Analytics: Check devices now! " + JSON.stringify(devicesSnap.val()));
                        if (devicesSnap.val() !== null) {
                            var devices = devicesSnap.val();
                            if (devices["ios"] !== null && devices["ios"] !== undefined) {
                                var ios = devices["ios"];
                                var token = ios["token"];
                                var lang = 'de'; //refactor if available
                                if (ios["language"] !== null) {
                                    lang = ios["language"];
                                }
                                if (token !== null) {
                                    if (this.msg !== null && this.msg[lang] !== undefined && this.msg[lang] !== null) {
                                        var co2msg = "CO2 is too high";
                                        if (this.msg[lang].airQualityMsg) {
                                            co2msg = this.msg[lang].airQualityMsg;
                                        }
                                        var iosMsg = {
                                            alert: this.roomName + ': ' + co2msg,
                                            payload: {
                                                'messageFrom': 'Cirql'
                                            }
                                        };
                                        notifications.send('ios', token, iosMsg);
                                        log.info({
                                            home: this.homeId,
                                            room: this.id
                                        }, " Roomclimate-Analytics: Notification to IOS device sent with " + token);
                                        var obj = {
                                            table: 'notifications',
                                            data: {
                                                homeid: this.homeId,
                                                roomid: this.id,
                                                residentid: key,
                                                reason: "{threshold: 1500}",
                                                msg: iosMsg
                                            }
                                        };
                                        storage.save(obj);
                                    } else {
                                        log.info({
                                            home: this.homeId,
                                            room: this.id
                                        }, " Roomclimate-Analytics: No airquality messages available for the room ");
                                    }

                                }
                            }
                            if (devices["android"] !== null && devices["android"] !== undefined) {
                                var android = devices["android"];
                                var token = android["token"];
                                var lang = 'de'; //refactor if available
                                if (android["language"] !== null) {
                                    lang = android["language"];
                                }
                                if (token !== null) {
                                    if (this.msg !== null && this.msg[lang] !== undefined && this.msg[lang] !== null) {
                                        var co2msg = "CO2 is too high";
                                        if (this.msg[lang].airQualityMsg) {
                                            co2msg = this.msg[lang].airQualityMsg;
                                        }
                                        var androidMsg = {
                                            alert: 'CO2 in ' + this.roomName,
                                            payload: co2msg
                                        };
                                        notifications.send('android', token, androidMsg);
                                        log.info({
                                            home: this.homeId,
                                            room: this.id
                                        }, " Roomclimate-Analytics: Notification to Android device sent with " + token);
                                        var obj = {
                                            table: 'notifications',
                                            data: {
                                                homeid: this.homeId,
                                                roomid: this.id,
                                                residentid: key,
                                                reason: "{threshold: 1500}",
                                                msg: co2msg
                                            }
                                        };
                                        storage.save(obj);
                                    } else {
                                        log.info({
                                            home: this.homeId,
                                            room: this.id
                                        }, " Roomclimate-Analytics: No airquality messages available for the room ");
                                    }

                                }
                            }
                        }

                    }, this);
                } else {
                    log.info({
                        home: this.homeId,
                        room: this.id
                    }, " Roomclimate-Analytics: Notification is skipped since resident with " + key + " is currently away");
                }
            }, this);
        }
    }
};

Room.prototype.updateHumidity = function(value) {
    if (value !== this.humidity && value !== null && value !== 'undefined') {

        this.humidity = value;
        this.fbRef.child('humidity').set(value);

        //Save to DB
        var timestamp = this.netatmo.getTimestamp();
        if (timestamp) {
            var obj = {
                table: 'measurements',
                data: {
                    homeid: this.homeId,
                    roomid: this.id,
                    timestamp: timestamp,
                    date: new Date(timestamp),
                    value: this.humidity,
                    type: 'humidity'
                }
            };
            storage.save(obj);
            this.history.save('humidity', this.humidity, timestamp);
        } else {
            log.warn({
                home: this.homeId,
                room: this.id
            }, "Didn't save humidity because netatmo timestamp is " + timestamp);
        }
    }


};

Room.prototype.updateManualChange = function(isManualChange, targetTemperature) {
    this.fbRef.child('manualSetpointChange').set(isManualChange);
    if (isManualChange) {
        if (this.heating !== null) {
            this.heating.reactToManualChange(targetTemperature);
        } else {
            log.warn({
                home: this.homeId,
                room: this.id
            }, ' Room: No Heating available!!! Should not happen');
        }
    }
};

Room.prototype.setFbRefOff = function() {
    this.fbRef.off();
    this.history.setFbRefOff();
    log.info({
        home: this.homeId,
        room: this.id
    }, ' Room: All fbRefs are set to off');
};


module.exports = Room;
