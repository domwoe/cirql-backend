/**
 * Activity controller class
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

var helper = require('./helperFuncs.js');
var _ = require('underscore');

/** Require configuration file */
var config = require('../config.json');
var fbBaseUrl = config.firebase;

var moment = require('moment-timezone');
moment().tz("Europe/Zurich").format();

// Activity class
function Activity(homeId, roomId) {
    this.homeId = homeId;
    this.roomId = roomId;
    this.templates = null;
    this.lastEventDate = null;
    this.lastEventDateUnix = null;
    this.systemStart = null;

    this.lastRawEvent = null;
    this.lastDeEventRef = null;
    this.lastEnEventRef = null;

    log.info({
        home: this.homeId,
        room: this.roomId,
        activity: this.roomId
    }, ' Activity: Initialized ');
    this.fbRefTemplate = new Firebase(fbBaseUrl + 'activityEvents');
    this.fbRefActivity = new Firebase(fbBaseUrl + 'homes/' + this.homeId + '/activity/' + this.roomId);
    this.fbRefRaw = new Firebase(fbBaseUrl + 'homes/' + this.homeId + '/activity/' + this.roomId + '/raw');
    this.fbRefLogDe = new Firebase(fbBaseUrl + 'homes/' + this.homeId + '/activity/' + this.roomId + '/de');
    this.fbRefLogEn = new Firebase(fbBaseUrl + 'homes/' + this.homeId + '/activity/' + this.roomId + '/en');
    this.fbRefSystem = new Firebase(fbBaseUrl + 'aSystemStart');


    this.fbRefSystem.on('value', function(fbSystemStart) {
        if (fbSystemStart.val() === false) {
            var date = new Date();
            var timestamp = date.toString();
            this.lastEventDate = timestamp;
            this.lastEventDateUnix = moment(timestamp);
            this.fbRefActivity.child('lastEventDate').set(this.lastEventDate);
            log.info({
                home: this.homeId,
                room: this.roomId,
                activity: this.roomId
            }, ' Set lastEventDate to now ');

            this.fbRefTemplate.once('value', function(fbTemplates) {
                if (fbTemplates.val()) {
                    this.templates = fbTemplates.val();
                    log.info('Templates for ActivityEvents are set');
                }

                this.fbRefRaw.on('child_added', function(fbRawEvent) {
                    if (fbRawEvent.val()) {
                        var rawEvent = fbRawEvent.val();
                        if (rawEvent['type']) {
                            var newEvent = this.processEvent(rawEvent);
                            var eventType = newEvent['type'];
                            // log.info({
                            //     home: this.homeId,
                            //     room: this.roomId,
                            //     activity: this.roomId
                            // }, 'Event ' + eventType + ' will checked now');
                            if (_.has(this.templates, eventType)) {
                                if (this.templates[eventType].show === true) {
                                    var eventDate = newEvent.date;
                                    var eventDateUnix = moment(newEvent.date);
                                    if (this.lastEventDateUnix !== null) {
                                        if (eventDateUnix > this.lastEventDateUnix - 1500) { // This delay can lead to some duplicates on system start, but it avoids that events at the same time are ignored. 

                                            //Finally add event
                                            var deMsg = this.templates[eventType].de;
                                            var enMsg = this.templates[eventType].en;
                                            for (var eventKey in rawEvent) {
                                                if (eventKey) {
                                                    if (eventKey !== 'type' && eventKey !== 'date') {
                                                        var value = newEvent[eventKey] + '';
                                                        deMsg = deMsg.replace('[' + eventKey + ']', value);
                                                        enMsg = enMsg.replace('[' + eventKey + ']', value);
                                                    }
                                                }
                                            }
                                            if (this.lastRawEvent !== null) {
                                                if (this.lastRawEvent['type'] === eventType && (eventDateUnix - this.lastEventDateUnix) <= 5 * 60000) {
                                                    if (this.lastDeEventRef !== null && this.lastEnEventRef !== null) {
                                                        this.removeEvent(newEvent);
                                                    }
                                                }
                                            }
                                            this.lastRawEvent = rawEvent;
                                            this.lastEventDate = eventDate;
                                            this.lastEventDateUnix = eventDateUnix;
                                            this.fbRefActivity.child('lastEventDate').set(eventDate);

                                            var deEvent = {
                                                'date': eventDate,
                                                'type': eventType,
                                                'msg': deMsg
                                            };
                                            this.lastDeEventRef = this.fbRefLogDe.push(deEvent);
                                            var enEvent = {
                                                'date': eventDate,
                                                'type': eventType,
                                                'msg': enMsg
                                            };
                                            this.lastEnEventRef = this.fbRefLogEn.push(enEvent);
                                            log.info({
                                                home: this.homeId,
                                                room: this.roomId,
                                                activity: this.roomId
                                            }, 'Event is pushed');
                                        }
                                    }
                                }
                            } else {
                                if (this.templates)
                                    log.warn({
                                        home: this.homeId,
                                        room: this.roomId,
                                        activity: this.roomId
                                    }, 'There is no templates for ActivityEvent ' + eventType);
                            }
                        } else {
                            log.warn({
                                home: this.homeId,
                                room: this.roomId
                            }, 'The rawEvent does not have a valid type ' + JSON.stringify(rawEvent));
                        }
                    }
                }, this);
            }, this);
        }
    }, this);

    this.fbRefTemplate.on('value', function(fbTemplates) {
        if (fbTemplates.val()) {
            this.templates = fbTemplates.val();
            log.info('Templates for ActivityEvents are set');
        }
    }, this);

    this.fbRefTemplate.child('cleanAll').on('value', function(fbCleanAll) {
        if (fbCleanAll.val()) {
            if (fbCleanAll.val() === true) {
                this.fbRefLogDe.set(null);
                this.fbRefLogEn.set(null);
                log.info({
                    home: this.homeId,
                    room: this.roomId,
                    activity: this.roomId
                }, 'Activity Logs deleted');
            }
        }
    }, this);

}


Activity.prototype.removeEvent = function(newEvent) {
    if (newEvent['type'] === 'manual-target') {
        if (newEvent['name'] === this.lastRawEvent['name']) {
            this.lastDeEventRef.remove();
            this.lastEnEventRef.remove();
        }
    } else if (newEvent['type'] === 'change-schedule') {
        this.lastDeEventRef.remove();
        this.lastEnEventRef.remove();
    } else if (newEvent['type'] === 'auto-away') {
        if (newEvent['name'] === this.lastRawEvent['name']) {
            this.lastDeEventRef.remove();
            this.lastEnEventRef.remove();
        }
    } else if (newEvent['type'] === 'change-mode') {
        if (newEvent['name'] === this.lastRawEvent['name']) {
            this.lastDeEventRef.remove();
            this.lastEnEventRef.remove();
        }
    } else if (newEvent['type'] === 'schedule-override') {
        if (newEvent['name'] === this.lastRawEvent['name']) {
            this.lastDeEventRef.remove();
            this.lastEnEventRef.remove();
        }
    } 

}


Activity.prototype.processEvent = function(rawEvent) {
    var newEvent = rawEvent;
    switch (rawEvent['type']) {
        case 'auto-away':
            if (rawEvent.value === true) {
                newEvent['type'] = 'autoaway-on';
            } else if (rawEvent.value === false) {
                newEvent['type'] = 'autoaway-off';
            } else {
                log.warn({
                    home: this.homeId,
                    room: this.roomId
                }, 'Can not process event ' + rawEvent['type']);
            }
            break;
        case 'change-mode':
            if (rawEvent.value === 'manu') {
                newEvent['type'] = 'change-mode-manu';
            } else if (rawEvent.value === 'auto') {
                newEvent['type'] = 'change-mode-auto';
            } else {
                log.warn({
                    home: this.homeId,
                    room: this.roomId
                }, 'Can not process event ' + rawEvent['type']);
            }
    }
    return newEvent;
};

Activity.prototype.setFbRefOff = function() {
    this.fbRefTemplate.off();
    this.fbRefActivity.off();
    this.fbRefRaw.off();
    this.fbRefLogDe.off();
    this.fbRefLogEn.off();
};

module.exports = Activity;
