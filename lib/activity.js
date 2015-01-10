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


function Activity(homeId, roomId) {
    this.homeId = homeId;
    this.roomId = roomId;
    this.templates = {};
    this.lastEventDate = null;
    this.lastEventDateUnix = null;

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

    this.fbRefActivity.child('lastEventDate').once('value', function(fbDate) {
        if (fbDate.val()) {
            this.lastEventDate = fbDate.val();
            this.lastEventDateUnix = moment(fbDate.val());
            log.info({
                home: this.homeId,
                room: this.roomId,
                activity: this.roomId
            }, 'Last event date is received: ' + this.lastEventDate);
        } else {
            var date = new Date();
            var timestamp = date.toString();
            this.lastEventDate = timestamp;
            this.lastEventDateUnix = moment(timestamp);
            log.info({
                home: this.homeId,
                room: this.roomId,
                activity: this.roomId
            }, ' Create first eventDate ');
        }
    }, this);

    this.fbRefTemplate.once('value', function(fbTemplates) {
        if (fbTemplates.val()) {
            this.templates = fbTemplates.val();
            log.info('Templates for ActivityEvents are set');

            this.fbRefRaw.on('child_added', function(fbRawEvent) {
                if (fbRawEvent.val()) {
                    var rawEvent = fbRawEvent.val();
                    if (rawEvent['type']) {
                        var newEvent = this.processEvent(rawEvent);
                        var eventType = newEvent['type'];
                        log.info({
                            home: this.homeId,
                            room: this.roomId,
                            activity: this.roomId
                        }, 'Event ' + eventType + ' will checked now');
                        if (_.has(this.templates, eventType)) {
                            if (this.templates[eventType].show === true) {
                                var eventDate = newEvent.date;
                                var eventDateUnix = moment(newEvent.date);
                                if (this.lastEventDateUnix !== null) {
                                    if (eventDateUnix > this.lastEventDateUnix - 1500) { // This delay can lead to some duplicates on system start, but it avoids that events at the same time are ignored. 
                                        this.lastEventDate = eventDate;
                                        this.lastEventDateUnix = eventDateUnix;
                                        this.fbRefActivity.child('lastEventDate').set(eventDate);
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
                                        var deEvent = {
                                            'date': eventDate,
                                            'type': eventType,
                                            'msg': deMsg
                                        };
                                        this.fbRefLogDe.push(deEvent);
                                        var enEvent = {
                                            'date': eventDate,
                                            'type': eventType,
                                            'msg': enMsg
                                        };
                                        this.fbRefLogEn.push(enEvent);
                                        log.info({
                                            home: this.homeId,
                                            room: this.roomId,
                                            activity: this.roomId
                                        }, 'Event is pushed');
                                    }
                                }
                            }
                        } else {
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
        }
    }, this);

     this.fbRefTemplate.once('value', function(fbTemplates) {
        if (fbTemplates.val()) {
            this.templates = fbTemplates.val();
            log.info('Templates for ActivityEvents are set');
        }
    },this);
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
    }
    return newEvent;
};

module.exports = Activity;
