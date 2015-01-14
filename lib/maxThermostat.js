/**
 * MaxThermostat class
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

var Nefit = require('./nefit.js');

/** Require configuration file */
var config = require('../config.json');
var fbBaseUrl = config.firebase;

function MaxThermostat(homeId, roomId, thermostatId) {

    this.homeId = homeId;
    this.roomId = roomId;
    this.thermostatId = thermostatId;
    this.isEnabled = false;

    this.nefit = new Nefit(homeId);

    this.fbRefThermostat = new Firebase(fbBaseUrl + 'homes/' + this.homeId + '/maxThermostats/' + this.thermostatId + '/');

    this.fbRefThermostat.child('isEnabled').on('value',function(fbIsEnabled) {

        log.info({
                    home: this.homeId,
                    room: this.roomId,
                    thermostat: this.thermostatId
        }, 'MaxThermostat: isEnabled: ' + fbIsEnabled.val());

        if (fbIsEnabled.val()) {
            this.isEnabled = fbIsEnabled.val();
        }
        else {
            this.isEnabled = false;
        }


    }, this);


}

MaxThermostat.prototype.setTarget = function(target, cb) {

    if (this.isEnabled) {

        this.nefit.setTarget(this.thermostatId, target, cb);

    }
    else {

        cb(null);
    }

};

MaxThermostat.prototype.setFbRefOff = function() {
    this.fbRefThermostat.child('isEnabled').off();
};

module.exports = MaxThermostat;
