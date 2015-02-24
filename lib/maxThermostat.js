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

// var Nefit = require('./nefit.js');

/** Require configuration file */
var config = require('../config.json');
var fbBaseUrl = config.firebase;

function MaxThermostat(homeId, roomId, thermostatId, nefit) {

    this.homeId = homeId;
    this.roomId = roomId;
    this.thermostatId = thermostatId;
    this.isEnabled = false;
    this.physAddr = null;
    this.isPhysAddrSet = false;

    this.nefit = nefit;

    this.fbRefThermostat = new Firebase(fbBaseUrl + 'homes/' + this.homeId + '/maxThermostats/' + this.thermostatId + '/');

    this.fbRefThermostat.child('isEnabled').on('value', function(fbIsEnabled) {

        log.info({
            home: this.homeId,
            room: this.roomId,
            thermostat: this.thermostatId
        }, 'MaxThermostat: isEnabled: ' + fbIsEnabled.val());

        if (fbIsEnabled.val()) {
            this.isEnabled = fbIsEnabled.val();
        } else {
            this.isEnabled = false;
        }


    }, this);


    this.fbRefThermostat.once('value', function(fbThermostat) {

        if (fbThermostat.child('physAddr').val()) {

            this.physAddr = fbThermostat.child('physAddr').val();
        }

        if (fbThermostat.child('isPhysAddrSet').val()) {
            this.isPhysAddrSet = fbThermostat.child('isPhysAddrSet').val();
        } else {
            this.isPhysAddrSet = false;

            // Set physAddr in Nefit Easy

            if (this.physAddr) {
                var self = this;
                this.nefit.setTrvAddress(this.physAddr, this.thermostatId, function(err, res) {
                    if (err) {

                        log.warn({
                            home: self.homeId,
                            room: self.roomId,
                            thermostat: self.thermostatId
                        }, 'MaxThermostat: Error while setting physAddr at Nefit Easy: ' + err + ' and ' + res);

                    } else {

                        log.info({
                            home: self.homeId,
                            room: self.roomId,
                            thermostat: self.thermostatId
                        }, 'MaxThermostat: Response of setting physAddr: ' + JSON.stringify(res));

                        self.isPhysAddrSet = true;
                        self.fbRefThermostat.child('isPhysAddrSet').set(true);


                    }
                });
            }
        }


        log.info({
            home: this.homeId,
            room: this.roomId,
            thermostat: this.thermostatId
        }, 'MaxThermostat: isPhysAddrSet: ' + this.isPhysAddrSet);




    }, this);



}

MaxThermostat.prototype.setTarget = function(target, cb) {

    //if (this.isEnabled && this.isPhysAddrSet) {
    if (this.isPhysAddrSet) {

        this.nefit.setTarget(this.thermostatId, target, cb);

    } else {

        var self = this;
        this.nefit.setTrvAddress(this.physAddr, this.thermostatId, function(err, res) {
            if (err) {

                log.warn({
                    home: self.homeId,
                    room: self.roomId,
                    thermostat: self.thermostatId
                }, 'MaxThermostat: Error while setting physAddr at Nefit Easy: ' + err + ' and ' + res);
                cb(null);

            } else {

                log.info({
                    home: self.homeId,
                    room: self.roomId,
                    thermostat: self.thermostatId
                }, 'MaxThermostat: Response of setting physAddr: ' + JSON.stringify(res));
                
                self.isPhysAddrSet = true;
                self.fbRefThermostat.child('isPhysAddrSet').set(true);

                self.nefit.setTarget(this.thermostatId, target, cb);


            }
        });

    }

};


MaxThermostat.prototype.setFbRefOff = function() {
    this.fbRefThermostat.child('isEnabled').off();
};

module.exports = MaxThermostat;