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
    this.setTempRetries = 0;
    this.setTemperatureTimeout = null;
    this.setTargetRetries = 0;
    this.setTargetTimeout = null;
    this.setPhysAddrRetries = 0;
    this.setPhysAddrTimeout = null;


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
            this.setPhysAddr();


        }

        log.info({
            home: this.homeId,
            room: this.roomId,
            thermostat: this.thermostatId
        }, 'MaxThermostat: isPhysAddrSet: ' + this.isPhysAddrSet);




    }, this);



}

MaxThermostat.prototype.setPhysAddr = function(cb) {

    function doSetPhysAddr() {

        log.info({
            home: this.homeId,
            room: this.roomId,
            thermostat: this.thermostatId,
            method: 'setPhysAddr',
            retry: this.setPhysAddrRetries

        });

        var self = this;
        this.nefit.setTrvAddress(this.physAddr, this.thermostatId, function(err, res) {
            if (err) {

                log.warn({
                    home: self.homeId,
                    room: self.roomId,
                    thermostat: self.thermostatId
                }, 'MaxThermostat: Error while setting physAddr at Nefit Easy: ' + err + ' and ' + res);

                var that = self;
                if (self.setPhysAddrRetries <= 10) {
                    self.setPhysAddrTimeout = setTimeout(
                        function() {
                            doSetPhysAddr.call(that);
                            that.setPhysAddrRetries++;
                        }, (self.setPhysAddrRetries + 1) * self.setPhysAddrRetries * 60 * 1000);
                }


            } else {

                log.info({
                    home: self.homeId,
                    room: self.roomId,
                    thermostat: self.thermostatId
                }, 'MaxThermostat: Response of setting physAddr: ' + JSON.stringify(res));

                self.isPhysAddrSet = true;
                self.fbRefThermostat.child('isPhysAddrSet').set(true);
                cb(true);


            }
        });
    }

    if (this.physAddr) {

        if (this.setPhysAddrTimeout) {
            clearTimeout(this.setPhysAddrTimeout);
        }

        this.setPhysAddrRetries = 0;

        doSetPhysAddr.call(this);

    }


};

MaxThermostat.prototype.setTarget = function(target) {

    function doSetTarget() {

        log.info({
            home: this.homeId,
            room: this.roomId,
            thermostat: this.thermostatId,
            method: 'setTarget',
            target: target,
            retry: this.setTargetRetries

        });

        var self = this;
        this.nefit.setTarget(this.thermostatId, target, function(err, res) {

            if (!err) {

                log.info({
                    home: self.homeId,
                    room: self.roomId,
                    thermostat: self.thermostatId,
                    method: 'setTarget',
                    target: target,
                    success: true,
                    response: res
                });

            } else {

                log.warn({
                    home: self.homeId,
                    room: self.roomId,
                    thermostat: self.thermostatId,
                    method: 'setTarget',
                    target: target,
                    success: false,
                    error: err
                });

                var that = self;
                if (self.setTargetRetries <= 10) {
                    self.setTargetTimeout = setTimeout(
                        function() {
                            doSetTarget.call(that);
                            that.setTargetRetries++;
                        }, (self.setTargetRetries + 1) * self.setTargetRetries * 60 * 1000);
                }


            }

        });
    }

    //if (this.isEnabled && this.isPhysAddrSet) {
    if (this.isPhysAddrSet) {

        if (this.setTargetTimeout) {
            clearTimeout(this.setTargetTimeout);
        }

        this.setTargetRetries = 0;

        doSetTarget.call(this);
    } else {
        var self = this;
        this.setPhysAddr(function(success) {
            if (success) {
                doSetTarget.call(self);
            }
        });
    }

    // } else {

    //     log.info({
    //         home: this.homeId,
    //         room: this.roomId,
    //         thermostat: this.thermostatId
    //     }, 'MaxThermostat: Address of thermostat seems not to be set. Setting address before setting target');

    //     var self = this;
    //     this.nefit.setTrvAddress(this.physAddr, this.thermostatId, function(err, res) {
    //         if (err) {

    //             log.warn({
    //                 home: self.homeId,
    //                 room: self.roomId,
    //                 thermostat: self.thermostatId
    //             }, 'MaxThermostat: Error while setting physAddr at Nefit Easy: ' + err + ' and ' + res);


    //             var that = self;
    //             setTimeout(function() {
    //                 that.setTarget(that.thermostatId, target);
    //             },30 * 1000);    

    //         } else {

    //             log.info({
    //                 home: self.homeId,
    //                 room: self.roomId,
    //                 thermostat: self.thermostatId
    //             }, 'MaxThermostat: Response of setting physAddr: ' + JSON.stringify(res));

    //             self.isPhysAddrSet = true;
    //             self.fbRefThermostat.child('isPhysAddrSet').set(true);

    //             self.setTarget(self.thermostatId, target);



    //         }
    //     });

    //}

};


MaxThermostat.prototype.setTemperature = function(temperature) {

    function doSetTemp() {

        log.info({
            home: this.homeId,
            room: this.roomId,
            thermostat: this.thermostatId,
            method: 'setTemperature',
            temperature: temperature,
            retry: this.setTempRetries

        });

        var self = this;
        this.nefit.setTemperature(this.thermostatId, temperature, function(err, res) {

            if (!err) {

                log.info({
                    home: self.homeId,
                    room: self.roomId,
                    thermostat: self.thermostatId,
                    method: 'setTemperature',
                    temperature: temperature,
                    success: true,
                    response: res
                });

            } else {

                log.warn({
                    home: self.homeId,
                    room: self.roomId,
                    thermostat: self.thermostatId,
                    method: 'setTemperature',
                    temperature: temperature,
                    success: false,
                    error: err
                });

                var that = self;
                if (self.setTempRetries < 10) {
                    self.setTemperatureTimeout = setTimeout(
                        function() {
                            doSetTemp.call(that);
                            that.setTempRetries++;
                        }, (self.setTempRetries + 1) * self.setTempRetries * 60 * 1000);
                }


            }

        });
    }

    //if (this.isEnabled && this.isPhysAddrSet) {
    if (this.isPhysAddrSet) {

        if (this.setTemperatureTimeout) {
            clearTimeout(this.setTemperatureTimeout);
        }

        this.setTempRetries = 0;

        doSetTemp.call(this);

    } else {
        var self = this;
        this.setPhysAddr(function(success) {
            if (success) {
                doSetTemp.call(self);
            }
        });
    }


    // } else {

    //     log.info({
    //         home: this.homeId,
    //         room: this.roomId,
    //         thermostat: this.thermostatId
    //     }, 'MaxThermostat: Address of thermostat seems not to be set. Setting address before setting target');

    //     var self = this;
    //     this.nefit.setTrvAddress(this.physAddr, this.thermostatId, function(err, res) {
    //         if (err) {

    //             log.warn({
    //                 home: self.homeId,
    //                 room: self.roomId,
    //                 thermostat: self.thermostatId
    //             }, 'MaxThermostat: Error while setting physAddr at Nefit Easy: ' + err + ' and ' + res);

    //             var that = self;
    //             setTimeout(function() {
    //                 that.setTemperature(that.thermostatId, temperature);
    //             },30 * 1000);    

    //         } else {

    //             log.info({
    //                 home: self.homeId,
    //                 room: self.roomId,
    //                 thermostat: self.thermostatId
    //             }, 'MaxThermostat: Response of setting physAddr: ' + JSON.stringify(res));

    //             self.isPhysAddrSet = true;
    //             self.fbRefThermostat.child('isPhysAddrSet').set(true);

    //             self.setTemperature(self.thermostatId, temperature);


    //         }
    //     });

    //}

};


MaxThermostat.prototype.setFbRefOff = function() {
    this.fbRefThermostat.child('isEnabled').off();
};

module.exports = MaxThermostat;