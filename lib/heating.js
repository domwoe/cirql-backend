/**
 * Heating controller class
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

var _ = require('underscore');

/** Require configuration file */
var config = require('../config.json');
var fbBaseUrl = config.firebase;

var moment = require('moment-timezone');
moment().tz("Europe/Zurich").format();

/** Maximal heatupTime */
var heatupLimit = 180;



function Heating(homeId, roomId) {
    this.homeId = homeId;
    this.roomId = roomId;
    /** The following values will be observed */
    // mode can be either manual or auto.
    // Maye be also off and holiday in the future
    this.mode = null;
    // Geolocation based heating feature
    this.usesAutoAway = null;
    this.isAway = null;
    // Estimated arrival time of nearest resident
    this.eta = null;
    // Measured room temperature
    this.temperature = null;
    // Target temperature as shown in app
    this.virtualTarget = null;
    // Factor that tells how much time the room
    // needs to heat uo 1 degree
    // Only used if hasPreheat = true
    this.heatupFactor = null;
    // Schedule object of items
    this.schedule = {};

    // Preheat feature
    this.hasPreheat = null;

    /** The following values will be set */
    this.status = null;
    this.realTarget = null;
    this.nextScheduledTarget = null;
    this.currentScheduledTarget = null;

    this.minAwayTemperature = 14;
    this.maxDiffToScheduledTarget = 5;
    this.heatupFactorForAutoAwayTargetCalc = 30;

    this.nextTargetTimer = null;



    //log.info('Heating FirebaseRef: '+fbBaseUrl+'homes/'+this.homeId+'/rooms/'+this.roomId);
    log.info({
        home: this.homeId,
        room: this.roomId
    }, ' Heating: Initialized ');
    this.fbRef = new Firebase(fbBaseUrl + 'homes/' + this.homeId + '/rooms/' + this.roomId);
    this.fbRefMode = this.fbRef.child('mode');
    this.fbRefUsesAutoAway = this.fbRef.child('usesAutoAway');
    this.fbRefIsAway = this.fbRef.child('isAway');
    this.fbRefTemperature = this.fbRef.child('temperature');
    this.fbRefEta = this.fbRef.child('eta');
    this.fbRefVirtualTarget = this.fbRef.child('virtualTarget');
    this.fbRefRealTarget = this.fbRef.child('realTarget');
    this.fbRefHeatupFactor = this.fbRef.child('heatupFactor');
    this.fbRefSchedule = this.fbRef.child('schedule');


    /** Init */
    this.fbRef.once('value', function(fbData) {
        if (!fbData.child('mode').val()) {
            this.fbRef.child('mode').set('manu');
        }
        this.mode = fbData.child('mode').val();
        this.usesAutoAway = fbData.child('usesAutoAway').val();
        this.temperature = fbData.child('temperature').val();
        this.eta = fbData.child('eta').val();
        this.virtualTarget = fbData.child('virtualTarget').val();
        this.heatupFactor = fbData.child('heatupFactor').val();
        this.schedule = fbData.child('schedule').val();
        this.hasPreheat = fbData.child('hasPreheat').val();
        this.isAway = fbData.child('isAway').val();

        switch (this.mode) {
            case 'manual':
                this.setTarget(this.virtualTarget, ' initial  manual mode ');
                break;
            case 'auto':
                var self = this;
                this.findScheduleItem(this.schedule, 'previous', function(e, objLastItem) {
                    if (e) {
                        log.warn(e);
                        return;
                    }
                    var target = self.schedule[objLastItem.key].target;
                    self.currentScheduledTarget = target;
                    self.setTarget(target, ' initial auto mode ');
                    self.setVirtualTarget(target, ' initial auto mode ');
                    self.planNextTarget();
                    self.setStatus();
                });
                break;
        }

    }, this);


    /** Listeners */
    this.fbGeolocationParams = new Firebase(fbBaseUrl + 'geolocation/');

    this.fbGeolocationParams.child('minAwayTemperature').on('value', function(param) {
        if (param.val()) {
            this.minAwayTemperature = param.val();
            log.info({
                home: this.homeId,
                user: this.userId
            }, ' Geolocation: minAwayTemperature is set to ' + param.val());
        }
    }, this);

    this.fbGeolocationParams.child('maxDiffToScheduledTarget').on('value', function(param) {
        if (param.val()) {
            this.maxDiffToScheduledTarget = param.val();
            log.info({
                home: this.homeId,
                user: this.userId
            }, ' Geolocation: maxDiffToScheduledTarget is set to ' + param.val());
        }
    }, this);


    this.fbGeolocationParams.child('heatupFactorForAutoAwayTargetCalc').on('value', function(param) {
        if (param.val()) {
            this.heatupFactorForAutoAwayTargetCalc = param.val();
            log.info({
                home: this.homeId,
                user: this.userId
            }, ' Geolocation: heatupFactorForAutoAwayTargetCalc is set to ' + param.val());
        }
    }, this);

    this.fbRefMode.on('value', function(fbMode) {
        var mode = fbMode.val();
        this.mode = mode;
        switch (mode) {
            case 'manual':
                clearTimeout(this.nextTargetTimer);
                this.setTarget(this.virtualTarget, ' manual mode ');
                break;
            case 'auto':
                var self = this;
                this.findScheduleItem(this.schedule, 'previous', function(e, objLastItem) {
                    if (e) {
                        log.warn(e);
                        return;
                    }
                    var target = self.schedule[objLastItem.key].target;
                    self.currentScheduledTarget = target;
                    self.setTarget(target, ' auto mode ');
                    self.setVirtualTarget(target, ' auto mode ');
                    self.planNextTarget();
                    self.setStatus();
                });
                break;
        }
        log.info({
            home: this.homeId,
            room: this.roomId
        }, ' Heating: Mode: ' + this.mode);

    }, this);

    this.fbRefUsesAutoAway.on('value', function(fbData) {
        log.info({
            home: this.homeId,
            room: this.roomId
        }, 'Heating: UsesAutoAway changed to ' + fbData.val());
        this.usesAutoAway = fbData.val();
        if (this.usesAutoAway !== null) {
            if (this.usesAutoAway) {
                this.planNextTarget();
            } else {
                this.setTarget(this.currentScheduledTarget, ' AutoAway off -> go back to normal schedule');
                this.setVirtualTarget(this.currentScheduledTarget, ' AutoAway off -> go back to normal schedule');
                this.planNextTarget();
            }
        }
    }, this);

    this.fbRefIsAway.on('value', function(fbData) {
        log.info({
            home: this.homeId,
            room: this.roomId
        }, 'Heating: isAway changed to ' + fbData.val());
        this.isAway = fbData.val();
        this.planNextTarget();
    }, this);

    this.fbRefTemperature.on('value', function(fbData) {
        log.info({
            home: this.homeId,
            room: this.roomId
        }, 'Heating: Temperature change: ' + fbData.val());
        this.temperature = fbData.val();
        this.planNextTarget();

    }, this);

    this.fbRefEta.on('value', function(fbData) {
        log.info({
            home: this.homeId,
            room: this.roomId
        }, 'Heating: ETA change ' + fbData.val());
        this.eta = fbData.val();
        this.planNextTarget();

    }, this);

    this.fbRefRealTarget.on('value', function(fbData) {
        if (fbData.val !== null) {
            this.realTarget = fbData.val();
        }
    }, this);


    this.fbRefVirtualTarget.on('value', function(fbData) {
        if (this.mode === 'manu') {
            this.virtualTarget = fbData.val();
            if (this.realTarget !== this.virtualTarget) {
                this.setTarget(this.virtualTarget, ' change of virtual target in manual mode');
            }
        } else if (this.mode === 'auto') {
            this.virtualTarget = fbData.val();
            if (this.realTarget !== this.virtualTarget) {
                this.setTarget(this.virtualTarget, ' change of virtual target in auto mode');
                //this.currentScheduledTarget = this.virtualTarget;
            }
        } else {
            log.warn({
                home: this.homeId,
                room: this.roomId
            }, ' Heating: Unknown mode: ' + this.mode);
        }
    }, this);

    this.fbRefHeatupFactor.on('value', function(fbData) {
        this.heatupFactor = fbData.val();
        this.planNextTarget();
    }, this);

    this.fbRefSchedule.on('value', function(fbData) {
        this.schedule = fbData.val();
        if (this.mode === 'auto') {
            var self = this;
            this.findScheduleItem(this.schedule, 'previous', function(e, objLastItem) {
                if (e) {
                    log.warn(e);
                    return;
                }
                var target = self.schedule[objLastItem.key].target;
                self.currentScheduledTarget = target;
                self.setTarget(target, ' schedule change ');
                self.setVirtualTarget(target, ' schedule change ');
                self.planNextTarget();
                self.setStatus();
            });
        } else {
            log.warn({
                home: this.homeId,
                room: this.roomId
            }, ' Heating: Unknown mode: ' + this.mode);
        }
    }, this);

}


/** Sets a timer to set next target temperature */
Heating.prototype.planNextTarget = function() {
    var self = this;
    var heatupTime = 0;
    var timeTillNextTarget = null;
    var target = null;
    var aaTarget = null;

    if (self.mode === 'auto') {

        this.findScheduleItem(this.schedule, 'next', function(e, objNextItem) {
            if (e) {
                log.warn(e);
                return;
            }
            timeTillNextTarget = objNextItem.time;
            target = self.schedule[objNextItem.key].target;
            self.setNextTarget(target,' planNextTarget ');

            /** Consider heatupTime */
            if (self.hasPreheat) {
                heatupTime = calcHeatupTime(self.temperature, self.heatupFactor, target);
                timeTillNextTarget = timeTillNextTarget - heatupTime;
            }

            /** AutoAway activated **/
            if (self.usesAutoAway) {
                /** Room is occupied */
                if (!self.isAway) {
                    self.setTargetTimer(target,timeTillNextTarget, ' autoaway schedule (at home) ');

                    // Room is unoccupied
                } else {
                    if (self.eta > 0) {
                        //This could lead to several problems, since the setpoint could jump around if both times are increasing
                        if (timeTillNextTarget - self.eta > 0) {
                            aaTarget = self.calcAutoAwayTarget(self.eta, self.temperature, self.currentScheduledTarget);
                            timeTillNextTarget = timeTillNextTarget - self.eta + 1;
                        } else {
                            aaTarget = self.calcAutoAwayTarget(self.eta, self.temperature, self.nextScheduledTarget);
                            timeTillNextTarget = timeTillNextTarget + 1;
                        }
                        // Set current Target
                        self.setTarget(aaTarget, ' autoaway schedule (away) ');
                      
                        // Schedule the next check (but no target!)
                        log.info({
                            home: self.homeId,
                            room: self.roomId
                        }, ' Heating: AutoAway: Time until we check the schedule again: ' + (timeTillNextTarget).toFixed(0) + ' minutes');
                        // (Not Necessary) --> self.setNextTargetDate((timeTillNextTarget).toFixed(0),' autoaway schedule (away) ');
                        clearTimeout(self.nextTargetTimer);
                        self.nextTargetTimer = setTimeout(function() {
                            log.info({
                                home: self.homeId,
                                room: self.roomId
                            }, ' AutoAway Timer is executed in ' + Math.max(0, timeTillNextTarget * 60 * 1000));
                            self.currentScheduledTarget = self.nextScheduledTarget;
                            self.planNextTarget();
                        }, Math.max(1500, timeTillNextTarget * 60 * 1000));

                    } else {
                        log.warn({
                            home: self.homeId,
                            room: self.roomId
                        }, ' Heating: AutoAway: Residents are away but the eta is still 0');
                    }
                }


            }
            /** Room is occupied */
            else {
                self.setTargetTimer(target,timeTillNextTarget, ' schedule ');
            }

        });

    }

};

// If target is not availabe, just start a timer again!
Heating.prototype.setTargetTimer = function(target, timeTillNextTarget, reason) {
            
                log.info({
                    home: this.homeId,
                    room: this.roomId
                }, ' Heating: timeTillNextTarget: ' + (timeTillNextTarget).toFixed(0) + ' minutes for target: ' + target);

                // Show Next Target Date
                this.setNextTargetDate((timeTillNextTarget).toFixed(0),reason);

                // Schedule Next Target
                var self = this;
                clearTimeout(this.nextTargetTimer);
                this.nextTargetTimer = setTimeout(function() {
                    log.info({
                        home: self.homeId,
                        room: self.roomId
                    }, ' Timer is executed with target: ' + target + ' in ' + Math.max(0, timeTillNextTarget * 60 * 1000));
                    self.currentScheduledTarget = target;
                    self.setTarget(target, reason);
                    self.setVirtualTarget(target, reason);
                    self.planNextTarget(); // Be careful - This recalls the original function planNextTarget!
                }, Math.max(1500, timeTillNextTarget * 60 * 1000));

};

Heating.prototype.setAway = function(value) {

    if (value !== null) {
        this.isAway = value;

        this.fbRefIsAway.set(value);
        log.info({
            home: this.homeId,
            room: this.roomId
        }, ' Heating:  Set room to isAway ' + value);
    }

};


Heating.prototype.setNextTarget = function(target, reason) {

    if (target !== null) {
        this.nextScheduledTarget = target;

        this.fbRef.child('nextTarget').set(target);
        log.info({
            home: this.homeId,
            room: this.roomId
        }, ' Heating:  Set nextTarget ' + target + ' by ' + reason);
    }

};

Heating.prototype.setNextTargetDate = function(time, reason) {

    if (time !== null) {
        var date = new Date();
        date.setTime(Date.now() + time * 60 * 1000 );
        this.fbRef.child('nextTargetDate').set(date.toString());
        log.info({
            home: this.homeId,
            room: this.roomId
        }, ' Heating:  Set nextTargetDate ' + time + ' by ' + reason);
    }

};

Heating.prototype.setTarget = function(target, reason) {

    if (target !== null) {
        this.realTarget = target;

        this.fbRef.child('realTarget').set(target);
        this.fbRef.child('reason').set(reason);
        log.info({
            home: this.homeId,
            room: this.roomId
        }, ' Heating:  Set new realTarget ' + target + ' by ' + reason);
    }

};


Heating.prototype.setVirtualTarget = function(target, reason) {
    if (target !== null) {
        this.fbRef.child('virtualTarget').set(target);
        log.info({
            home: this.homeId,
            room: this.roomId
        }, ' Heating:  Set new virtualTarget ' + target + ' by ' + reason);
    }
};




Heating.prototype.setStatus = function() {

    var status = null;

    if (this.mode === 'auto') {
        /* AutoAway modus is active */
        if (this.usesAutoAway) {
            /** Residents are away */
            if (this.eta > 0) {
                status = 'away';
            }
            /** Room is occupied */
            else {
                /** is preheating */
                if (this.realTarget > this.virtualTarget) {
                    status = 'preheating';
                } else {
                    status = 'normal';
                }
            }
        }
        /** Regular schedule is active */
        else {
            /** is preheating */
            if (this.hasPreheat) {
                if (this.realTarget > this.virtualTarget) {
                    status = 'preheating';
                }
            } else {
                status = 'normal';
            }

        }
    }
    /** Manual Mode */
    else {

    }

    this.status = status;
    log.info({
        home: this.homeId,
        room: this.roomId
    }, ' Heating: Status: ' + this.status);
    this.fbRef.child('status').set(status);

};


/**
 *  React to a ManualChange Event
 */
Heating.prototype.reactToManualChange = function(target) {
    this.setTarget(target, ' manual change at thermostat ');
    this.setVirtualTarget(target, ' manual change at thermostat ');
    log.info({
        home: this.homeId,
        room: this.roomId
    }, ' Heating:  Manual Change accepted ' + target);
};

/**
 * Calculate time it takes to heat up to nextTarget
 */
function calcHeatupTime(temperature, heatupFactor, nextTarget) {

    var heatupTime = Math.max(0, heatupFactor * (nextTarget - temperature));
    if (heatupTime > heatupLimit) {
        return heatupLimit;
    } else {
        return heatupTime;
    }
}

/**
 * Finds last or next (as specified by which) schedule item.
 * Callback functions has to be in the form function(error, {key, time})
 * where key directs to the correponding scheduleEvent
 * and time is the time in ms from now until that event (only for next)
 */
Heating.prototype.findScheduleItem = function(schedule, which, cb) {
    if (!_.isEmpty(schedule)) {
        var maxMinutesDiff = 0;
        var minMinutesDiff = 99999999999;

        var key = null;

        for (var scheduleEventKey in schedule) {
            //(function(i) {

            var item = schedule[scheduleEventKey];

            var totalMinutesUntilNow = ((moment().tz("Europe/Zurich").isoWeekday() - 1) * 24 * 60) + (moment().tz("Europe/Zurich").hours() * 60) + moment().tz("Europe/Zurich").minutes();
            //  console.log('totalMinNow: ' + totalMinutesUntilNow );
            var totalMinutesOfItem = ((item.weekday - 1) * 24 * 60) + (item.hour * 60) + item.minute;
            //  console.log('totalMinItem: ' + totalMinutesOfItem );

            var totalMinutesDiff = mod((totalMinutesOfItem - totalMinutesUntilNow), (24 * 7 * 60));

            //  console.log('Total Diff in Minutes: ' + totalMinutesDiff );
            var dayDiffs = Math.floor(totalMinutesDiff / 60 / 24);
            //  console.log('Diff in days: ' + dayDiffs);
            var hourDiffs = Math.floor(totalMinutesDiff / 60 % 24);
            //  console.log('Diff in hours: ' + hourDiffs);
            var minDiffs = Math.floor(totalMinutesDiff % 60);
            //  console.log('Diff in minutes: ' + minDiffs);

            if (which === 'previous') {
                if (totalMinutesDiff >= maxMinutesDiff) {
                    maxMinutesDiff = totalMinutesDiff;
                    key = scheduleEventKey;
                }
            } else if (which === 'next') {
                if (totalMinutesDiff <= minMinutesDiff) {
                    minMinutesDiff = totalMinutesDiff;
                    key = scheduleEventKey;
                }
            } else {
                log.warn({
                    home: this.homeId,
                    room: this.roomId
                }, ' Heating:  Invalid Function Call Parameter: ' + which);
            }

        }

        if (which === 'previous') {
            //log.info({home: this.homeId, room: this.roomId}, ' Heating: Previous Schedule event is in '+ maxMinutesDiff +' min --> ' + JSON.stringify(schedule[key]));
            cb(null, {
                key: key,
                time: maxMinutesDiff
            });
        } else if (which === 'next') {
            // log.info({home: this.homeId, room: this.roomId}, ' Heating: Next Schedule event is in '+ minMinutesDiff +' min --> ' + JSON.stringify(schedule[key]));
            cb(null, {
                key: key,
                time: minMinutesDiff
            });
        }

    }
    //cb(new Error('Schedule is empty'), null);  
};

Heating.prototype.calcAutoAwayTarget = function(eta, temperature, scheduledTarget) {
    // TODO - Calculate auto away target based on scheduled Target  
    var target = null;

    if ((temperature <= this.minAwayTemperature) || (scheduledTarget <= this.minAwayTemperature)) {
        log.info({
            home: this.homeId,
            room: this.roomId
        }, ' Heating: Auto Away TargetCalc: Target is not changed since temperature: ' + temperature + ' and setpoint ' + scheduledTarget);
        target = scheduledTarget;
    } else {

        var targetDiff = Math.min(this.maxDiffToScheduledTarget, (Math.round(eta / this.heatupFactorForAutoAwayTargetCalc * 2) / 2).toFixed(1));
        var newTarget = Math.max(this.minAwayTemperature, scheduledTarget - targetDiff);

        //Set target
        log.info({
            home: this.homeId,
            room: this.roomId
        }, ' Heating: Auto Away Target Calc is: ' + newTarget + ' for scheduledTarget of ' + scheduledTarget + ' and eta ' + eta + ' with temp ' + temperature);
        target = newTarget;
    }

    return target;

};

function milliSecToDate(text, time) {
    var tmins = (time / 1000 / 60).toFixed(0);
    var hours = Math.floor(tmins / 60);
    var mins = tmins % 60;
    console.log(text + ' Time: ' + hours + ' h ' + mins + ' mins');
}

// Javascript does not a valid modulo opertion for negative numbers, so we fix that here
function mod(m, n) {
    return ((m % n) + n) % n;
}

Heating.prototype.setFbRefOff = function() {
    this.fbRef.off();
    this.fbRefMode.off();
    this.fbRefUsesAutoAway.off();
    this.fbRefIsAway.off();
    this.fbRefTemperature.off();
    this.fbRefEta.off();
    this.fbRefVirtualTarget.off();
    this.fbRefRealTarget.off();
    this.fbRefHeatupFactor.off();
    this.fbRefSchedule.off();
    log.info({
        home: this.homeId,
        room: this.roomId
    }, ' Heating: All fbRefs are set to off');
};


module.exports = Heating;
