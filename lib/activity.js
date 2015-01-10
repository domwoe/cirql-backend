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
        }
        else {
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

    this.fbRefTemplate.on('value', function(fbTemplates) {
        if (fbTemplates.val()) {
            this.templates = fbTemplates.val();
            log.info('Templates for ActivityEvents are set');
        }
    }, this);

    this.fbRefRaw.on('child_added', function(fbRawEvent) {
        if (fbRawEvent.val()) {
            var rawEvent = fbRawEvent.val();
            if (rawEvent['type']) {
                var eventType = rawEvent['type'];
                if (_.has(this.templates, eventType)) {
                    var eventDate = rawEvent.date;
                    var eventDateUnix = moment(eventDate);
                    if (this.lastEventDateUnix !== null) {
                        if (eventDateUnix > this.lastEventDateUnix - 1500) { // This delay can lead to some duplicates on system start, but it avoids that events at the same time are ignored. 
                            this.lastEventDate = eventDate;
                            this.lastEventDateUnix = eventDateUnix;
                            this.fbRefActivity.child('lastEventDate').set(eventDate);
                            //Finally add event
                            var deMsg = this.templates[eventType].de;
                            var newDeMsg;
                            var enMsg = this.templates[eventType].en;
                            var newEnMsg;
                            for (var eventKey in rawEvent) {
                                if (eventKey) {
                                    if (eventKey !== 'type' && eventKey !== 'date') {
                                        var value = rawEvent[eventKey] + '';
                                        newDeMsg = deMsg.replace('[' + eventKey + ']', value);
                                        newEnMsg = enMsg.replace('[' + eventKey + ']', value);
                                    }
                                }
                            }
                            var deEvent = {'date': eventDate, 'type': eventType, 'msg': newDeMsg};
                                this.fbRefLogDe.push(deEvent);
                            var enEvent = {'date': eventDate, 'type': eventType, 'msg': newEnMsg};
                                this.fbRefLogEn.push(enEvent);
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



module.exports = Activity;
