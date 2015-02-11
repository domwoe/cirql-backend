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

function Room(homeId, roomId) {

    events.EventEmitter.call(this);
    this.id = roomId;
    this.homeId = homeId;
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
    this.residentFbRefs = {};
    this.residentEtas = {};
    this.residentAways = {};
    this.category = null;
    this.valve = null;

    this.history = new History(this.homeId, this.id);

    log.info({
        home: this.homeId,
        room: this.id
    }, ' Room: Initialized ');
    this.fbRef = new Firebase(fbBaseUrl + 'homes/' + this.homeId + '/rooms/' + this.id);
    this.fbRefActivity = new Firebase(fbBaseUrl + 'homes/' + this.homeId + '/activity/');

    this.fbRefTemplates = new Firebase(fbBaseUrl + 'templates/');

    this.fbRefActivity.on('child_added', function(fbRawLog) {
        if (fbRawLog.name()) {
            var id = fbRawLog.name();
            if (id === this.id) {
                this.activity = new Activity(this.homeId, this.id);
                log.info({
                    home: this.homeId,
                    room: this.id,
                    activity: this.id
                }, ' Room: Activity Log for room created');
            }
        }
    }, this);

    this.fbRefActivity.child(this.id).on('child_removed', function(fbRawLog) {
        if (fbRawLog.name()) {
            var id = fbRawLog.name();
            if (id === 'raw') {
                if (this.activity !== null) {
                    this.activity.setFbRefOff();
                    log.info({
                        home: this.homeId,
                        room: this.id,
                        activity: this.id
                    }, ' Room: Activity Log for room deleted');
                    this.activity = null;
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
        var thermostatId = fbThermostat.name();
        log.info({
            home: this.homeId,
            room: this.id
        }, ' Room: new MaxThermostat ' + thermostatId);
        this.maxThermostats[thermostatId] = new MaxThermostat(this.homeId, this.id, thermostatId);

    }, this);


    this.fbRef.child('maxThermostats').on('child_removed', function(fbThermostat) {
        var id = fbThermostat.name();
        var thermostatObj = this.maxThermostats[id];

        if (thermostatObj) {
            log.info({
                home: this.homeId,
                room: this.id
            }, ' Room: delete MaxThermostat with id: ' + id);
            thermostatObj.setFbRefOff();
            delete this.maxThermostats[id];
        }

        if (Object.keys(this.MaxThermostats).length === 0) {
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
            var self = this;
            this.maxThermostats[maxId].setTarget(this.realTarget, function(result) {
                if (result && result.res && result.res.statusCode && result.res.statusCode === 204) {
                    log.info({
                        home: self.homeId,
                        room: self.id
                    }, ' Room: Set target of  MaxThermostat ' + maxId + ' to ' + self.realTarget + ' successful');
                } else {
                    log.warn({
                        home: self.homeId,
                        room: self.id
                    }, ' Room: Set target of  MaxThermostat ' + maxId + ' to ' + self.realTarget + ' not successful: ' + JSON.stringify(result));

                }
            });

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
                this.roomclimate.setFbRefOff();
                this.roomclimate = null;
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




    this.fbRef.child('usesAutoAway').on('value', function(fbAutoAway) {
        var callback1 = null;
        var callback2 = null;
        var callbackAllowGeo = null;

        if (fbAutoAway.val()) {
            this.fbRef.child('residents').on('child_added', function(fbResident) {
                var residentId = fbResident.name();
                if (residentId !== null && residentId !== undefined) {
                    callback1 = function(fbEta) {
                        if (fbEta) {
                            this.residentEtas[residentId] = fbEta.val();
                            log.info({
                                home: this.homeId,
                                room: this.id
                            }, ' Room: Resident with id ' + residentId + ' has new ETA ' + fbEta.val());
                            this.calcMinEta();
                        }
                    };

                    callback2 = function(fbIsAway) {
                        if (fbIsAway) {
                            this.residentAways[residentId] = fbIsAway.val();
                            log.info({
                                home: this.homeId,
                                room: this.id
                            }, ' Room: Resident with id ' + residentId + ' is away ' + fbIsAway.val());
                            this.calcAwayState();
                        }
                    };



                    this.fbRef.child('residents').child(residentId).on('value', function(fbResident) {
                        var residentIsConsideredForRoom = fbResident.val();
                        if (residentIsConsideredForRoom === true) {
                            log.info({
                                home: this.homeId,
                                room: this.id
                            }, ' Room: Resident with id ' + residentId + ' is added ');
                            var fbRefResident = new Firebase(fbBaseUrl + 'homes/' + this.homeId + '/residents/' + residentId);
                            this.residentFbRefs[residentId] = fbRefResident;

                            callbackAllowGeo = function(fbAllowGeo) {
                                if (fbAllowGeo.val() && fbAllowGeo.val() === true) {
                                    fbRefResident.child('eta').on('value', callback1, this);
                                    fbRefResident.child('isAway').on('value', callback2, this);
                                } else {
                                    if (callback1 !== null && callback2 !== null) {
                                        fbRefResident.child('eta').off('value', callback1, this);
                                        fbRefResident.child('isAway').off('value', callback2, this);
                                        delete this.residentEtas[residentId];
                                        delete this.residentAways[residentId];
                                        this.calcMinEta();
                                        this.calcAwayState();
                                    }
                                }
                            };

                            fbRefResident.child('allowsGeolocation').on('value', callbackAllowGeo, this);

                        } else if (residentIsConsideredForRoom === false) {
                            if (this.residentFbRefs[residentId] !== null && this.residentFbRefs[residentId] !== undefined) {
                                log.info({
                                    home: this.homeId,
                                    room: this.id
                                }, ' Room: Resident with id ' + residentId + ' is deleted');
                                console.log('Delete ref to residentId: ' + residentId);
                                if (callback1 !== null && callback2 !== null && callbackAllowGeo !== null) {
                                    this.residentFbRefs[residentId].child('allowsGeolocation').off('value', callbackAllowGeo, this);
                                    this.residentFbRefs[residentId].child('eta').off('value', callback1, this);
                                    this.residentFbRefs[residentId].child('isAway').off('value', callback2, this);
                                    this.residentFbRefs[residentId].off('value');

                                    delete this.residentFbRefs[residentId];
                                    if (this.residentEtas[residentId] !== null && this.residentEtas[residentId] !== undefined) {
                                        delete this.residentEtas[residentId];
                                    }
                                    if (this.residentAways[residentId] !== null && this.residentAways[residentId] !== undefined) {
                                        delete this.residentAways[residentId];
                                    }
                                    if (Object.keys(this.residentFbRefs).length !== 0) {
                                        this.calcMinEta();
                                        this.calcAwayState();

                                    }
                                }

                            }
                        } else {

                        }
                    }, this);
                }
            }, this);
        } else {
            for (var residentKey in this.residentFbRefs) {
                if (callback1 !== null && callback2 !== null && callbackAllowGeo !== null) {
                    this.residentFbRefs[residentKey].child('allowsGeolocation').off('value', callbackAllowGeo, this);
                    this.residentFbRefs[residentKey].child('eta').off('value', callback1, this);
                    this.residentFbRefs[residentKey].child('isAway').off('value', callback2, this);
                }
            }
            this.fbRef.child('residents').off('child_added');
            this.residentFbRefs = {};
            this.residentEtas = {};
            this.residentAways = {};
            this.fbRef.child('eta').set(0);
            this.fbRef.child('isAway').set(false);
            log.info({
                home: this.homeId,
                room: this.id
            }, ' Room: AutoAway off  - All resident refs deleted');
        }
    }, this);
}



util.inherits(Room, events.EventEmitter);

Room.prototype.calcMinEta = function() {
    var minEta = 60 * 60 * 24 * 7;
    for (var residentKey in this.residentEtas) {
        var currentEta = this.residentEtas[residentKey];
        if (currentEta) {
            if (currentEta < minEta) {
                minEta = currentEta;
            }
        }
    }
    if (minEta !== 60 * 60 * 24 * 7) {
        console.log('MinEta is ' + minEta);
        this.fbRef.child('eta').set(minEta);
    } else {
        log.info({
            home: this.homeId,
            room: this.id
        }, ' Room: Min Eta Calc has not changed ETA ');
    }
};

Room.prototype.calcAwayState = function() {
    var isAway = true;
    var oneRun = false;
    for (var residentKey in this.residentAways) {
        log.info({
            home: this.homeId,
            room: this.id
        }, ' Room: resident ' + residentKey + ' isAway = ' + this.residentAways[residentKey]);
        oneRun = true;
        var currentIsAway = this.residentAways[residentKey];
        if (currentIsAway !== null) {
            if (currentIsAway === false) {
                isAway = false;
            }
        } else {
            log.info({
                home: this.homeId,
                room: this.id
            }, ' Room: The Away-State of the resident is not defined ');
        }
    }
    if (oneRun) {
        this.fbRef.child('isAway').set(isAway);
        log.info({
            home: this.homeId,
            room: this.id
        }, ' Room: The Away-State of the room is now: ' + isAway);
    } else {
        log.info({
            home: this.homeId,
            room: this.id
        }, ' Room: There are no residents for computing isAway State');
    }
};


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

    var netatmoUpToDate;

    if (this.netatmo !== null) {
        if ((Date.now() - (this.netatmo.getTimestamp())) < 30 * 60 * 1000) {
            netatmoUpToDate = true;
        } else {
            netatmoUpToDate = false;
            log.info({
                home: this.homeId,
                room: this.id
            }, 'Netatmo is not up-to-date!');
        }
    } else {

        netatmoUpToDate = false;

    }


    if (this.netatmo !== null && this.netatmo.getTemperature() !== null && netatmoUpToDate) {
        if (this.temperature !== this.netatmo.getTemperature()) {
            log.info({
                home: this.homeId,
                room: this.id
            }, ' Room: new temperature of ' + this.netatmo.getTemperature() + ' is set by netatmo');
        }
        this.temperature = this.netatmo.getTemperature();
        this.fbRef.child('temperature').set(this.netatmo.getTemperature());

        // Update external temperature of thermostats
        if (this.hasThermostats) {
            // log.info({
            //     home: this.homeId,
            //     room: this.id
            // }, ' Room: Update external temperature of ' + this.netatmo.getTemperature());

            for (var thermostatKey in this.thermostats) {
                var thermostat = this.thermostats[thermostatKey];
                thermostat.setExternalTemperature({
                    'timestamp': this.netatmo.getTimestamp(),
                    'value': this.netatmo.getTemperature()
                });
            }
        }



    } else if (Object.keys(this.thermostats).length !== 0) {
        var avgTemp = this.calcAvgThermostatTemperature();
        if (avgTemp !== 0.0) {
            if (this.temperature !== avgTemp && !isNaN(avgTemp)) {
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
            }, ' Room: No temperature measurements found!');
        }
    } else {
        log.warn({
            home: this.homeId,
            room: this.id
        }, ' Room: No temperature measurement since  netatmo or thermostats are not available');
    }

    //Save to DB
    var obj = {
        table: 'measurements',
        data: {
            homeid: this.homeId,
            roomid: this.id,
            value: this.temperature,
            type: 'temperature',
        }
    };

    if (netatmoUpToDate) {
        obj.data.timestamp = this.netatmo.getTimestamp();
        obj.data.date = new Date(this.netatmo.getTimestamp());
    }
    storage.save(obj);
    this.history.save('temperature', this.temperature);
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
    if (value !== this.co2 && this.co2 !== null) {
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

    this.co2 = value;
    this.fbRef.child('co2').set(value);

};

Room.prototype.updateHumidity = function(value) {
    if (value !== this.humidity && this.humidity !== null) {
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
    this.humidity = value;
    this.fbRef.child('humidity').set(value);

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
