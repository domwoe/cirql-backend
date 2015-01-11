/**
 * Roomclimate informatin class
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
/** Require configuration file */
var config = require('../config.json');
var fbBaseUrl = config.firebase;

function findState(value, thresholds, cb) {
    for (var color in thresholds) {
        thresholds[color].forEach(function(range, index) {
            if (value >= range.start && value < range.end) {
                cb(color, index);
            }
        });
    }
}

function Roomclimate(homeId, roomId) {
    this.homeId = homeId;
    this.roomId = roomId;
    this.co2 = null;
    this.humidity = null;
    this.thresholds = {};
    this.messages = {};

    log.info({
        home: this.homeId,
        room: this.roomId
    }, ' Roomclimate: Initialized ');
    this.fbRef = new Firebase(fbBaseUrl + 'homes/' + this.homeId + '/rooms/' + this.roomId);
    this.fbRefActivity = new Firebase(fbBaseUrl + 'homes/' + this.homeId + '/activity/' + this.roomId + '/raw');
    this.fbRefMessages = new Firebase(fbBaseUrl + 'messages');

    this.fbRef.child('co2').on('value', function(co2snap) {
        if (co2snap.val()) {
            log.info({
                home: this.homeId,
                room: this.roomId
            }, ' Roomclimate: Got new co2');
            var co2 = co2snap.val();
            this.co2 = co2;
            this.generateMsg('airquality');
        } else {
            log.warn({
                home: this.homeId,
                room: this.id
            }, " Roomclimate: Can't get co2 value");

        }
    }, this);

    this.fbRef.child('humidity').on('value', function(humiditySnap) {
        if (humiditySnap.val()) {
            log.info({
                home: this.homeId,
                room: this.roomId
            }, ' Roomclimate: Got new humidity');
            var humidity = humiditySnap.val();
            this.humidity = humidity;
            this.generateMsg('humidity');
        } else {
            log.warn({
                home: this.homeId,
                room: this.roomId
            }, " Roomclimate: Can't get humidity value");

        }
    }, this);

    this.fbRef.child('thresholds').on('value', function(thresholdsSnap) {

        if (thresholdsSnap.val()) {
            log.info({
                home: this.homeId,
                room: this.roomId
            }, ' Roomclimate: Got new thresholds ' + JSON.stringify(thresholdsSnap.val()));
            this.thresholds = thresholdsSnap.val();
            this.generateMsg('airquality');
            this.generateMsg('humidity');

        } else {
            log.warn({
                home: this.homeId,
                room: this.roomId
            }, " Roomclimate: Can't get thresholds");

        }

    }, this);

    this.fbRefMessages.on('value', function(messagesSnap) {

        if (messagesSnap.val()) {
            log.info({
                home: this.homeId,
                room: this.roomId
            }, ' Roomclimate: Got new messages ' + JSON.stringify(messagesSnap.val()));
            this.messages = messagesSnap.val();
            this.generateMsg('airquality');
            this.generateMsg('humidity');
        } else {
            log.warn({
                home: this.homeId,
                room: this.roomId
            }, " Roomclimate: Couldn't get messages");
        }

    }, this);


}

Roomclimate.prototype.generateMsg = function(type) {
    var msg = '';
    var self = this;
    var languages = {
        'de': true,
        'en': true
    };

    switch (type) {
        case 'airquality':
            if (self.thresholds && self.thresholds.hasOwnProperty('co2')) {
                findState(self.co2, self.thresholds.co2, function(state) {
                    for (var lang in languages) {
                        if (self.messages[lang] && self.messages[lang].hasOwnProperty('co2')) {
                            var eventData;
                            if (state === 'green') {
                                msg = self.messages[lang].co2.green;
                                if (lang === 'en') {
                                    eventData = helper.createRawEvent('co2-green');
                                    self.fbRefActivity.push(eventData);
                                }
                            } else if (state === 'yellow') {
                                msg = self.messages[lang].co2.yellow;
                                if (lang === 'en') {
                                    eventData = helper.createRawEvent('co2-yellow');
                                    self.fbRefActivity.push(eventData);
                                }
                            } else if (state === 'red') {
                                msg = self.messages[lang].co2.red;
                                if (lang === 'en') {
                                    eventData = helper.createRawEvent('co2-red');
                                    self.fbRefActivity.push(eventData);
                                }
                            }
                            log.info({
                                home: self.homeId,
                                room: self.roomId
                            }, ' Roomclimate: Setting ' + type + ' message ' + msg);
                            self.fbRef.child('msg/' + lang + '/airQualityMsg').set(msg);
                        } else {
                            log.warn({
                                home: self.homeId,
                                room: self.roomId
                            }, ' Roomclimate: Messages has no property co2');
                        }
                    }
                });
            } else {
                log.warn({
                    home: self.homeId,
                    room: self.roomId
                }, ' Roomclimate: Thresholds has no property co2');

            }
            break;

        case 'humidity':
            if (self.thresholds && self.thresholds.hasOwnProperty('humidity')) {
                findState(self.humidity, self.thresholds.humidity, function(state, index) {
                    for (var lang in languages) {
                        if (self.messages[lang] && self.messages[lang].hasOwnProperty('humidity')) {
                            if (state === 'green') {
                                msg = self.messages[lang].humidity.green;
                            } else if (state === 'yellow') {
                                if (index === 0) {
                                    msg = self.messages[lang].humidity.yellow.low;
                                } else if (index === 1) {
                                    msg = self.messages[lang].humidity.yellow.high;
                                }
                            } else if (state === 'red') {
                                if (index === 0) {
                                    msg = self.messages[lang].humidity.red.low;
                                } else if (index === 1) {
                                    msg = self.messages[lang].humidity.red.high;
                                }
                            }
                            log.info({
                                home: self.homeId,
                                room: self.roomId
                            }, ' Roomclimate: Setting ' + type + ' message ' + msg);
                            self.fbRef.child('msg/' + lang + '/humidityMsg').set(msg);
                        } else {
                            log.warn({
                                home: self.homeId,
                                room: self.roomId
                            }, ' Roomclimate: Messages has no property humidity');
                        }
                    }
                });
            } else {
                log.warn({
                    home: self.homeId,
                    room: self.roomId
                }, ' Roomclimate: Thresholds has no property humidity');

            }

            break;

        default:
            log.warn({
                home: this.homeId,
                room: this.roomId
            }, ' Roomclimate: Unknown type for generating room climate message');
    }

};

Roomclimate.prototype.setFbRefOff = function() {
    this.fbRef.off();
    this.fbRefMessages.off();
    log.info({
        home: this.homeId,
        room: this.roomId
    }, ' Roomclimate: All fbRefs are set to off');
};

module.exports = Roomclimate;
