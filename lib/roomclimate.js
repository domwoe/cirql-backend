/**
 * Roomclimate informatin class
 *
 */

/*jslint node: true */
'use strict';

var Firebase = require('firebase');
var bunyan = require('bunyan');
var bunyanLogentries = require('bunyan-logentries');
var LinkedList = require('linkedlist');

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
    this.stateCO2 = null;

    this.co2Slope = null;
    this.co2StartTime = null;
    this.co2StartValue = null;
    this.co2History = null;
    this.prevco2 = null;

    log.info({
        home: this.homeId,
        room: this.roomId
    }, ' Roomclimate: Initialized ');
    this.fbRef = new Firebase(fbBaseUrl + 'homes/' + this.homeId + '/rooms/' + this.roomId);
    this.fbRefActivity = new Firebase(fbBaseUrl + 'homes/' + this.homeId + '/activity/' + this.roomId + '/raw');
    this.fbRefAnalytics = new Firebase(fbBaseUrl + 'homes/' + this.homeId + '/analytics/' + this.roomId);

    this.fbRefMessages = new Firebase(fbBaseUrl + 'messages');

    this.fbRef.child('co2').on('value', function(co2snap) {
        if (co2snap.val()) {
            log.info({
                home: this.homeId,
                room: this.roomId
            }, ' Roomclimate: Got new co2');
            var co2 = co2snap.val();
            this.prevco2 = this.co2;
            this.co2 = co2;
            this.generateMsg('airquality');
            this.checkAirQuality();
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

    this.fbRefAnalytics.child('co2-dec').on('child_added', function(co2DecEvent) {
        log.info({
            home: this.homeId,
            room: this.roomId
        }, " Roomclimate-Analytics: is called ");
        if (this.co2History === null) {
            this.co2History = new LinkedList();
        }
        if (co2DecEvent.val() !== null) {
            if (this.co2History.length <= 3) {
                this.co2History.push(co2DecEvent.key());
                log.info({
                    home: this.homeId,
                    room: this.roomId
                }, " Roomclimate-Analytics: Add co2-dec event with key " + co2DecEvent.key() + " to linkedlist ");
            } else {
                var keyOfOldestHistoryEvent = this.co2History.tail;
                if (keyOfOldestHistoryEvent !== null && keyOfOldestHistoryEvent !== undefined) {
                    log.info({
                        home: this.homeId,
                        room: this.roomId
                    }, " Roomclimate-Analytics: Delete the oldest co2-dec event with key: " + keyOfOldestHistoryEvent);
                    this.fbRefAnalytics.child("co2-dec").child(keyOfOldestHistoryEvent).remove();
                    this.co2History.shift();
                }
                else {
                    log.info({
                        home: this.homeId,
                        room: this.roomId
                    }, " Roomclimate-Analytics: Delete the oldest co2-dec not possible");
                }
            }
        }
    }, this);

    this.fbRefMessages.on('value', function(messagesSnap) {

        if (messagesSnap.val()) {
            // log.info({
            //     home: this.homeId,
            //     room: this.roomId
            // }, ' Roomclimate: Got new messages ' + JSON.stringify(messagesSnap.val()));
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

Roomclimate.prototype.checkAirQuality = function() {
    if (this.co2 !== null && this.prevco2 !== null) {
        log.info({
            home: this.homeId,
            room: this.roomId
        }, " Roomclimate-Analytics: Check Air Quality for " + this.co2 + " and " + this.prevco2);
        if (this.co2Slope === "co2-dec") {
            if (this.co2 <= this.prevco2) {
                // do nothing - keep on counting
            } else {
                var co2DecHistoryEvent = {
                    "type": "co2-dec",
                    "startTime": this.co2StartTime,
                    "stopTime": Date.now(),
                    "startValue": this.co2StartValue,
                    "stopValue": this.prevco2
                };
                this.co2Slope = "co2-inc";
                this.co2StartTime = Date.now();
                this.co2StartValue = this.co2;
                this.fbRefAnalytics.child('co2-dec').push(co2DecHistoryEvent);
            }
        } else if (this.co2Slope === "co2-inc") {
            if (this.co2 >= this.prevco2) {
                // do nothing - keep on counting
            } else {
                var co2IncHistoryEvent = {
                    "type": "co2-inc",
                    "startTime": this.co2StartTime,
                    "stopTime": Date.now(),
                    "startValue": this.co2StartValue,
                    "stopValue": this.prevco2
                };
                this.co2Slope = "co2-dec";
                this.co2StartTime = Date.now();
                this.co2StartValue = this.co2;
            }
        } else {
            if (this.co2 < this.prevco2) {
                this.co2Slope = "co2-dec";
                this.co2StartTime = Date.now();
                this.co2StartValue = this.co2;
            } else if (this.co2 > this.prevco2) {
                this.co2Slope = "co2-inc";
                this.co2StartTime = Date.now();
                this.co2StartValue = this.co2;
            } else {
                log.info({
                    home: this.homeId,
                    room: this.roomId
                }, " Roomclimate-Analytics: It is unclear if co2-dec or co2-inc");
            }
        }
    }
};



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
                            var param;
                            if (state === 'green') {
                                msg = self.messages[lang].co2.green;
                                if (lang === 'en') {
                                    self.stateCO2 = 'green';
                                }
                            } else if (state === 'yellow') {
                                msg = self.messages[lang].co2.yellow;
                                if (lang === 'en') {
                                    if (self.stateCO2 !== null && self.stateCO2 === 'green') {
                                        param = {
                                            'value': self.co2
                                        };
                                        eventData = helper.createRawEvent('co2-red', param);
                                        self.fbRefActivity.push(eventData);
                                    }
                                    self.stateCO2 = 'yellow';
                                }
                            } else if (state === 'red') {
                                msg = self.messages[lang].co2.red;
                                if (lang === 'en') {
                                    if (self.stateCO2 !== null && self.stateCO2 === 'yellow') {
                                        param = {
                                            'value': self.co2
                                        };
                                        eventData = helper.createRawEvent('co2-red', param);
                                        self.fbRefActivity.push(eventData);
                                    }
                                    self.stateCO2 = 'red';
                                }
                            }
                            // log.info({
                            //     home: self.homeId,
                            //     room: self.roomId
                            // }, ' Roomclimate: Setting ' + type + ' message ' + msg);
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
                            // log.info({
                            //     home: self.homeId,
                            //     room: self.roomId
                            // }, ' Roomclimate: Setting ' + type + ' message ' + msg);
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
