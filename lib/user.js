/**
 * User class
 *
 */

/*jslint node: true */
'use strict';

var Firebase = require('firebase');
var bunyan = require('bunyan');
var bunyanLogentries = require('bunyan-logentries');

var helper = require('./helperFuncs.js');

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

var Geolocation = require('./geolocation.js');

/** Require configuration file */
var config = require('../config.json');
var fbBaseUrl = config.firebase;

function User(homeId, userId) {
    this.id = userId;
    this.homeId = homeId;
    this.name = null;
    this.isAway = null;
    this.allowsGeo = null;
    this.geolocation = null;
    this.eta = null;
    this.rooms = null;

    log.info({
        home: this.homeId,
        user: this.id
    }, ' User: Initialized ');
    this.fbRef = new Firebase(fbBaseUrl + 'homes/' + this.homeId + '/residents/' + this.id);
    this.fbRefActivity = new Firebase(fbBaseUrl + 'homes/' + this.homeId + '/activity');


    this.fbRef.child('name').on('value', function(fbData) {
        log.info({
            home: this.homeId,
            user: this.id
        }, 'User has name: ' + fbData.val());
        this.name = fbData.val();
    }, this);


    this.fbRef.child('rooms').on('value', function(fbData) {
        if (fbData.val()) {
            log.info({
                home: this.homeId,
                user: this.id
            }, 'User has rooms: ' + JSON.stringify(fbData.val()));
            this.rooms = fbData.val();
        }
    }, this);

    this.fbRef.child('isAway').on('value', function(fbData) {
        if (fbData.val() !== null) {
            // Maintain activity log
            if (this.isAway !== null && this.isAway !== fbData.val()) {
                if (this.rooms !== null) {
                    for (var roomKey in this.rooms) {
                        if (this.rooms[roomKey] === true) {
                            var param, eventData;
                            if (fbData.val() === true) {
                                param = {
                                    'name': this.name
                                };
                                eventData = helper.createRawEvent('resident-away', param);
                                this.fbRefActivity.child(roomKey).child('raw').push(eventData);
                            } else if (fbData.val() === false) {
                                param = {
                                    'name': this.name
                                };
                                eventData = helper.createRawEvent('resident-home', param);
                                this.fbRefActivity.child(roomKey).child('raw').push(eventData);
                            }
                        }
                    }
                }
            }
            // Update local isAway state
            log.info({
                home: this.homeId,
                user: this.id
            }, 'User ' + this.name + ' isAway: ' + fbData.val());
            this.isAway = fbData.val();
        } else {
            log.warn({
                home: this.homeId,
                user: this.id
            }, 'Away State of user ' + this.name + ' is not set! ');
            this.isAway = false;
        }
    }, this);

    this.fbRef.child('eta').on('value', function(fbData) {
        if (fbData.val() !== null) {
            if (this.eta !== null && fbData.val() !== this.eta) {
                if (this.isAway === true) { // Report only  if resident is not at home
                    if (this.rooms !== null) {
                        for (var roomKey in this.rooms) {
                            if (this.rooms[roomKey] === true) {
                                var param;
                                var type;
                                if (this.eta < fbData.val()) {
                                    param = {
                                        'name': this.name,
                                        'eta': fbData.val()
                                    };
                                    type = 'resident-eta-leaving';
                                } else {
                                    param = {
                                        'name': this.name,
                                        'eta': fbData.val()
                                    };
                                    type = 'resident-eta-coming';
                                }
                                var eventData = helper.createRawEvent(type, param);
                                this.fbRefActivity.child(roomKey).child('raw').push(eventData);
                            }
                        }
                    }
                }
            }
            this.eta = fbData.val();
        }
    }, this);

    this.fbRef.child('allowsGeolocation').on('value', function(fbData) {
        if (fbData.val() !== null) {
            log.info({
                home: this.homeId,
                user: this.id
            }, 'User ' + this.name + ' allowsGeolocation: ' + fbData.val());
            this.allowsGeo = fbData.val();
            if (this.allowsGeo) {
                this.geolocation = new Geolocation(this.homeId, this.id);
                log.info({
                    home: this.homeId,
                    user: this.id
                }, 'Geolocation activated for user ' + this.name);
            } else {
                if (this.geolocation) {
                    this.geolocation.setFbRefOff();
                }
                this.geolocation = null;
                log.info({
                    home: this.homeId,
                    user: this.id
                }, 'Geolocation deactivated for user ' + this.name);
            }
        } else {
            log.warn({
                home: this.homeId,
                user: this.id
            }, 'allowsGeolocation flag is not set' + this.name);
            this.allowsGeo = false;
        }
    }, this);


    User.prototype.setFbRefOff = function() {
        this.fbRef.child('name').off();
        this.fbRef.child('isAway').off();
        log.info({
            home: this.homeId,
            room: this.id
        }, ' User: All FbRefs are set to off');
    };

}

module.exports = User;
