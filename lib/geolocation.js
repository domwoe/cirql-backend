/**
 * Geolocation class
 *
 */

/*jslint node: true */
'use strict';


var Firebase = require('firebase');
var geolib = require('geolib');
var bunyan = require('bunyan');
var bunyanLogentries = require('bunyan-logentries');
var moment = require('moment-timezone');

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


/**
 * [Geolocation description]
 * @param {[integer]} home
 * @param {[integer]} user
 */
var gm = require('googlemaps');

/** Require configuration file */
var config = require('../config.json');
var fbBaseUrl = config.firebase;



function Geolocation(homeId, userId) {
    this.userId = userId;
    this.homeId = homeId;
    this.homeCoords = null;
    this.locCoords = null;
    this.lastTimeStamp = 0;

    // Example coordiantes
    // Should be retrieved from firebase 

    this.fbRefHome = new Firebase(fbBaseUrl + 'homes/' + this.homeId + '/homelocation/');

    this.fbRefHome.on('value', function(fbData) {
        if (fbData.val()) {
            this.homeCoords = {};
            this.homeCoords.lat = fbData.val().lat;
            this.homeCoords.lng = fbData.val().lng;
        }
    }, this);

    this.fbRefLoc = new Firebase(fbBaseUrl + 'homes/' + this.homeId + '/residents/' + this.userId + '/lastLocation/');

    this.fbRefLoc.child('homeregion').on('value', function(fbAtHome) {
        if (fbAtHome.val() != null) {
            var userRef = this.fbRefLoc.parent();
            userRef.child('isAway').set(!fbAtHome.val());
        } else {
            log.info({
                home: this.homeId,
                user: this.userId
            }, ' Geolocation: It is unknown if user is in HomeRegion ');
        }
    }, this);

    this.fbRefLoc.child('lastMsg').on('value', function(fbData) {
        if (fbData.val()) {
            var date = fbData.val().date;
        }

    }, this);

    this.fbRefLoc.on('value', function(fbData) {
        if (fbData.val()) {
            if (fbData.val().timestamp > this.lastTimeStamp) {
                this.lastTimeStamp = fbData.val().timestamp;
                this.locCoords = {};
                this.locCoords.lat = fbData.val().lat;
                this.locCoords.lng = fbData.val().lng;

                var coordsstrings = this.coords2string(this.locCoords);
                var self = this;
                gm.reverseGeocode(coordsstrings, function(err, data) {
                    if (err) {
                        log.warn({
                            home: self.homeid,
                            user: self.userId
                        }, ' Geolocation: Reverse Geocoding of last location failed 1');
                    } else {
                        if (data) {
                            if (data.status === 'OK') {
                                var results = data.results[0];
                                log.info({
                                    home: self.homeId,
                                    user: self.userId
                                }, ' Geolocation: Current Location is ' + results.formatted_address);
                                self.fbRefLoc.child("formatted_address").set(results.formatted_address);
                            } else {
                                log.warn({
                                    home: self.homeId,
                                    user: self.userId
                                }, ' Geolocation: Reverse Geocoding of last location failed with ' + data.status);
                            }
                        }
                    }
                });

                if (this.homeCoords && this.locCoords) {
                    this.getTravelTime(this.homeCoords, this.locCoords, 'driving', function(err, data) {
                        if (err) {
                            log.warn({
                                home: self.homeId,
                                user: self.userId
                            }, ' Geolocation: Traveltime calc failed with error ' + err);
                        } else {
                            if (data) {
                                if (data.status === 'OK') {
                                    var userRef = self.fbRefLoc.parent().child('lastTravelTime');
                                    userRef.child('updated').set(moment().format('MMM Do YYYY, H:mm'));
                                    userRef.child('travelDistance').set(data.distance.value);
                                    userRef.child('travelDistanceText').set(data.distance.text);
                                    userRef.child('etaText').set(data.duration.text);
                                    userRef.child('eta').set(data.duration.value);
                                    log.info({
                                        home: self.homeId,
                                        user: self.userId
                                    }, ' Geolocation: Resident has eta of ' + data.duration.text + ' with distance ' + data.distance.text);
                                } else {
                                    log.warn({
                                        home: self.homeId,
                                        user: self.userId
                                    }, ' Geolocation: Traveltime calculation failed with ' + data.status);
                                }
                            }
                        }
                    });
                }

                if (this.homeCoords && this.locCoords) {
                    var distance = geolib.getDistance({
                        "latitude": this.homeCoords.lat,
                        "longitude": this.homeCoords.lng
                    }, {
                        "latitude": this.locCoords.lat,
                        "longitude": this.locCoords.lng
                    });

                    if (distance) {
                        var userRef = this.fbRefLoc.parent().child('lastDistance');
                        userRef.child('updated').set(moment().format('MMM Do YYYY, H:mm'));
                        userRef.child('directDistance').set(distance);
                        userRef.child('directDistanceText').set(distance + " m");
                    }
                }

            }
        }
    }, this);
}


/**
 * Return distance and travel time between locCoords and homeCoords for a
 * specified travel mode
 * @param  {object}   locCoords
 * @param  {object}   homeCoords
 * @param  {string}   mode (can be walking, driving or transit)
 * @param  {Function} callback = function(err,data) where data is object
 * example:   { distance: { text: '2.2 km', value: 2234 },
 *          duration: { text: '23 mins', value: 1367 },
 *          status: 'OK' }
 */
Geolocation.prototype.getTravelTime = function(locCoords, homeCoords, mode, callback) {


    var sLocCoords = this.coords2string(locCoords);
    var sHomeCoords = this.coords2string(homeCoords);

    // Tells google maps that the location coordinates stems from a
    // sensor device
    var sensor = true;

    // console.log(sLocCoords);

    var self = this;
    gm.distance(sLocCoords, sHomeCoords, function(err, data) {
            if (err) {
                log.warn({
                    home: self.homeId,
                    user: self.userId
                }, ' Geolocation: gm.distance calculation failed with: ' + err);
            }
            if (data) {
                if (data.hasOwnProperty('rows') && data.rows[0].hasOwnProperty('elements')) {
                    callback(null, data.rows[0].elements[0]);
                } else {
                    callback(err, data);
                }
            }

        },
        sensor, mode);
};

/**
 * Utility function to convert a coordination
 * object in a string consisting of lat and lon.
 * This is needed for the google maps api.
 * @param  {object} coords
 * @return {string}
 */
Geolocation.prototype.coords2string = function(coords) {
    var coordsAsString = coords.lat + ',' + coords.lng;
    return coordsAsString;
}

Geolocation.prototype.setFbRefOff = function() {
    this.fbRefHome.off();
    this.fbRefLoc.off();
};



module.exports = Geolocation;
