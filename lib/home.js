/**
 * Home class
 *
 */

/*jslint node: true */
'use strict';

var Firebase = require('firebase');
var bunyan = require('bunyan');
var bunyanLogentries = require('bunyan-logentries');
var gm = require('googlemaps');


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

var User = require('./user.js');

var Room = require('./room.js');

var NetatmoAPI = require('./netatmoapi.js');

var Log = require('./log.js');

var Nefit = require('./nefit.js');

/** Require configuration file */
var config = require('../config.json');
var fbBaseUrl = config.firebase;

var fbBaseRef = new Firebase(fbBaseUrl);

function Home(id) {
    this.id = id;
    this.rooms = {};
    this.users = {};
    this.address = null;
    this.city = null;
    this.country = null;
    this.postcode = null;

    this.nefit = null;

    this.fbRef = new Firebase(fbBaseUrl + 'homes/' + id);

    this.appLogStorage = new Log(this.id);

    this.fbRef.child('address').on('value', function(fbData) {
        this.address = fbData.val();
        this.geocodeAddress();
    }, this);

    this.fbRef.child('city').on('value', function(fbData) {
        this.city = fbData.val();
        this.geocodeAddress();
    }, this);

    this.fbRef.child('country').on('value', function(fbData) {
        this.country = fbData.val();
        this.geocodeAddress();
    }, this);

    this.fbRef.child('postcode').on('value', function(fbData) {
        this.postcode = fbData.val();
        this.geocodeAddress();
    }, this);


    this.fbRef.child('settings').on('value', function(fbData) {
        if (fbData.val()) {
            var settings = fbData.val();
            this.address = settings.address;
            this.postcode = settings.postcode;
            this.city = settings.city;
            this.country = settings.country;
            this.geocodeAddress();
            log.info({
                home: this.id
            }, ' Home-Address changed!');
        }
    }, this);

    /**
    /* Listen for netatmo
    /* and create new netatmoapi object
    */
    this.fbRef.child('sensors').on('child_added', function(sensor) {
        if (sensor.name() === 'netatmo') {
            log.info({
                home: this.id
            }, 'Netatmo added');
            this.netatmo = new NetatmoAPI(this.id);
            var self = this;
            setTimeout(function() {
                self.netatmo.getDevices();
            }, 2000);
        }
    }, this);

    /** Listen if netatmo is deleted and deletes netatmoapi obj */
    this.fbRef.child('sensors').on('child_removed', function(sensor) {
        log.info({
            home: this.id
        }, ' Home: child_removed event for sensors');
        if (sensor.name() === 'netatmo' && this.hasOwnProperty('netatmo')) {
            log.info({
                home: this.id
            }, ' Home: delete Netatmo');
            this.netatmo.setFbRefOff();
            delete this.netatmo;
        }


    }, this);

    this.fbRef.child('nefit').on('value', function(fbNefit) {
        if (this.nefit === null && fbNefit.val()) {
            
            log.info({
                home: this.id
            }, 'Nefit Gateway');

            this.nefit = new Nefit(this.id);
            
        }
    }, this);

    // TO DO: When nefit deleted
    // Probably needs implementation of event emitter

    /**
    /* Listen if new room is added to home in firebase
    /* and create new room object
    */
    this.fbRef.child('rooms').on('child_added', function(fbRoom) {
        var roomId = fbRoom.name();
        log.info({
            home: this.id
        }, ' Home: new Room with id: ' + roomId);
        var roomObject = new Room(id, roomId, this);
        var self = this;
        (function listenForNetatmo() {
            roomObject.on('netatmoModuleAdded', function(data) {
                if (self.hasOwnProperty('netatmo')) {
                    self.netatmo.start({
                        stationId: data.stationId,
                        moduleId: data.moduleId,
                        type: 'temperature,humidity,co2'
                    });
                } else {
                    self.interval = setInterval(function() {
                        if (self.hasOwnProperty('netatmo')) {
                            clearInterval(self.interval);
                            delete self.interval;
                            self.netatmo.start({
                                stationId: data.stationId,
                                moduleId: data.moduleId,
                                type: 'temperature,humidity,co2'
                            });
                        }
                    }, 2000);
                }
            });
            roomObject.on('netatmoModuleDeleted', function(data) {
                self.netatmo.stop(data.moduleId);
            });
        }());

        /**
         * Check if thresholds are available and add
         * threshold templates
         */
        // if (!fbRoom.hasChild('thresholds')) {
        var category = fbRoom.child('category').val();
        if (category) {
            fbBaseRef
                .child('templates')
                .child(category)
                .child('thresholds')
                .once('value', function(fbThresholds) {
                    fbRoom.ref().child('thresholds').set(fbThresholds.val());
                });
        }
        // } 

        this.rooms[roomId] = roomObject;
    }, this);


    /** Listen if room is deleted and deletes room obj */
    this.fbRef.child('rooms').on('child_removed', function(fbRoom) {
        log.info({
            home: this.id
        }, ' Home: child_removed event for rooms');
        var id = fbRoom.name();

        var roomObj = this.rooms[id];

        if (roomObj) {
            log.info({
                home: this.id
            }, ' Home: delete Room with id: ' + id);
            roomObj.setFbRefOff();
            delete this.rooms[id];
        }


    }, this);

    this.fbRef.child('residents').on('child_added', function(fbUser) {
        var userId = fbUser.name();
        log.info({
            home: this.id
        }, ' Home: Add a new user with id ' + userId);
        this.users[userId] = new User(this.id, userId);
    }, this);

    this.fbRef.child('residents').on('child_removed', function(fbUser) {
        var userId = fbUser.name();
        var userObj = this.users[userId];

        if (userObj) {
            log.info({
                home: this.homeId
            }, ' Home: Delete user with id ' + userId);
            userObj.setFbRefOff();
            delete this.users[userId];
        }
    }, this);

}

Home.prototype.geocodeAddress = function() {

    if (this.address && this.postcode && this.city && this.country) {
        var completeAddress = this.address + ',' + this.postcode + ' ' + this.city + ',' + this.country;
        log.info({
            home: this.id
        }, 'Geocoding for: ' + completeAddress);

        var self = this;
        gm.geocode(completeAddress, function(err, data) {
            if (err) {
                log.warn({
                    home: self.id
                }, 'Geocoding Problem with: ' + completeAddress);
            }
            if (data) {
                if (data.status === 'OK') {
                    var results = data.results[0];
                    log.info({
                        home: self.id
                    }, 'Chosen Address: ' + results.formatted_address);
                    var location = results.geometry.location;
                    location.formattedAddress = results.formatted_address;
                    log.info({
                        home: self.id
                    }, 'Chosen Location ' + JSON.stringify(location));
                    self.fbRef.child("homelocation").set(location);
                } else {
                    log.warn({
                        home: self.id
                    }, 'Geocoding Problem with: ' + completeAddress);
                }
            }
        });
    }
};

Home.prototype.getNefit = function() {

    return this.nefit;

};


module.exports = Home;