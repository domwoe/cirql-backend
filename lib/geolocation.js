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
    this.regions = null;

    this.avgTravelSpeedForRegionsETA = 1000; // 1000 meter/minute  = 60 kmh
    this.maxDistanceForDirectRegionUpdates = 45000; // in meters
    this.maxEtaForAtHome = 1; // in minutes
    this.delayTimeToPrioritiseTravelTimeUpdates = 900; // 15 minutes

    this.eta = 0;

    this.regionUpdate = 0;
    this.isCloserThan = 90000000;
    this.isFarerThan = 0;

    this.distanceUpdate = 0;
    this.distance = 0;

    this.travelTimeUpdate = 0;
    this.travelEta = 0;

    this.homeRegionSeen = false;
    this.insideHomeRegion = false;
    this.homeRegionDate = null;


    this.fbGeolocationParams = new Firebase(fbBaseUrl + 'geolocation/');

    this.fbGeolocationParams.child('delayTimeToPrioritiseTravelTimeUpdates').on('value', function(param) {
        if (param.val()) {
            this.delayTimeToPrioritiseTravelTimeUpdates = param.val();
            log.info({
                home: this.homeId,
                user: this.userId
            }, ' Geolocation: delayTimeToPrioritiseTravelTimeUpdates is set to ' + param.val());
        }
    }, this);

    this.fbGeolocationParams.child('avgTravelSpeedForRegionsETA').on('value', function(param) {
        if (param.val()) {
            this.avgTravelSpeedForRegionsETA = param.val();
            log.info({
                home: this.homeId,
                user: this.userId
            }, ' Geolocation: avgTravelSpeedForRegionsETA is set to ' + param.val());
        }
    }, this);
    this.fbGeolocationParams.child('maxDistanceForDirectRegionUpdates').on('value', function(param) {
        if (param.val()) {
            this.maxDistanceForDirectRegionUpdates = param.val();
            log.info({
                home: this.homeId,
                user: this.userId
            }, ' Geolocation: maxDistanceForDirectRegionUpdates is set to ' + param.val());
        }
    }, this);

    this.fbGeolocationParams.child('maxEtaForAtHome').on('value', function(param) {
        if (param.val()) {
            this.maxEtaForAtHome = param.val();
            log.info({
                home: this.homeId,
                user: this.userId
            }, ' Geolocation: maxEtaForAtHome is set to ' + param.val());
        }
    }, this);




    // Example coordiantes
    // Should be retrieved from firebase 
    this.fbResident = new Firebase(fbBaseUrl + 'homes/' + this.homeId + '/residents/' + this.userId + '/');

    this.fbResident.child('eta').on('value', function(fbData) {
        if (fbData.val()) {
            this.eta = fbData.val();
        }
    }, this);

    this.fbResident.child('byDistance').child('updated').once('value', function(data) {
        if (data.val()) {
            this.distanceUpdate = moment(data.val());
        }
    },this)

    this.fbResident.child('byRegion').child('updated').once('value', function(data) {
        if (data.val()) {
            this.regionUpdate = moment(data.val());
        }
    },this)

    this.fbResident.child('byTravelTime').child('updated').once('value', function(data) {
        if (data.val()) {
            this.travelTimeUpdate = moment(data.val());
        }
    },this)

    this.fbRefHome = new Firebase(fbBaseUrl + 'homes/' + this.homeId + '/homelocation/');

    this.fbRefHome.on('value', function(fbData) {
        if (fbData.val()) {
            this.homeCoords = {};
            this.homeCoords.lat = fbData.val().lat;
            this.homeCoords.lng = fbData.val().lng;
        }
    }, this);

    this.fbRefRegions = new Firebase(fbBaseUrl + 'homes/' + this.homeId + '/residents/' + this.userId + '/lastRegions/');


    this.fbRefRegions.on('value', function(fbRegions) {
        if (fbRegions.val() !== null) {
            this.regions = fbRegions.val();
            //FIRST check home region
            if (this.regions.reg1) {
                this.homeRegionSeen = true;
                this.insideHomeRegion = this.regions.reg1.isInside;
                this.homeRegionDate = moment(this.regions.reg1.date);
            } else {
                this.homeRegSeen = false;
                this.insideHomeRegion = false;
            }

            this.isCloserThan = 90000000;
            this.isFarerThan = 0;
            var somethingIsFar = false;
            var somethingIsClose = false;
            for (var regionKey in this.regions) {

                var currRegion = this.regions[regionKey];
                if (currRegion.isInside) {
                    somethingIsClose = true;
                    if (currRegion.radius < this.isCloserThan) {
                        this.isCloserThan = currRegion.radius;

                    }
                } else {
                    somethingIsFar = true;
                    if (currRegion.radius > this.isFarerThan) {
                        this.isFarerThan = currRegion.radius;

                    }
                }
            }
            // Take care of the special cases if resident is in one of the most close/far regions
            if (!somethingIsFar) {
                this.isFarerThan = 0;
            }
            if (!somethingIsClose) {
                this.isCloserThan = 90000000;
            }

            var userRef = this.fbRefRegions.parent();
            userRef.child('isSeen').set(moment().tz("Europe/Zurich").format('MMM Do YYYY, H:mm'));
            userRef.child('byRegion').child('updated').set(moment().tz("Europe/Zurich").format('MMM Do YYYY, H:mm'));
            this.regionUpdate = Date.now();
            console.log('region update ' + this.regionUpdate);
            if (this.isCloserThan !== 90000000) {
                userRef.child('byRegion').child('isCloserThan').set(this.isCloserThan);
            } else {
                userRef.child('byRegion').child('isCloserThan').set(null);
            }
            if (this.isFarerThan !== 0) {
                userRef.child('byRegion').child('isFarerThan').set(this.isFarerThan);
            } else {
                userRef.child('byRegion').child('isFarerThan').set(null);
            }
            this.calculateETA();
            this.checkHomeAway();
        } else {
            log.info({
                home: this.homeId,
                user: this.userId
            }, ' Geolocation: There are no region events so far');
        }
    }, this);


    this.fbRefLoc = new Firebase(fbBaseUrl + 'homes/' + this.homeId + '/residents/' + this.userId + '/lastLocation/');
    this.fbRefLoc.on('value', function(fbData) {
        if (fbData.val()) {
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

            if (this.homeCoords && this.locCoords && this.homeCoords.lat && this.homeCoords.lng && this.locCoords.lat && this.locCoords.lng) {
                this.getTravelTime(this.homeCoords, this.locCoords, 'driving', function(err, data) {
                    if (err) {
                        log.warn({
                            home: self.homeId,
                            user: self.userId
                        }, ' Geolocation: Traveltime calc failed with error ' + err);
                    } else {
                        if (data) {
                            if (data.status === 'OK') {
                                self.fbRefLoc.parent().child('isSeen').set(moment().tz("Europe/Zurich").format('MMM Do YYYY, H:mm'));
                                var userRef = self.fbRefLoc.parent().child('byTravelTime');
                                self.travelTimeUpdate = Date.now();
                                console.log('travel time update: ' + self.travelTimeUpdate);
                                userRef.child('updated').set(moment().tz("Europe/Zurich").format('MMM Do YYYY, H:mm'));
                                userRef.child('travelDistance').set(data.distance.value);
                                userRef.child('travelDistanceText').set(data.distance.text);
                                userRef.child('etaText').set(data.duration.text);
                                userRef.child('eta').set(Math.round(data.duration.value / 60));
                                self.travelEta = Math.round(data.duration.value / 60);
                                self.calculateETA();
                                self.checkHomeAway();
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

            if (this.homeCoords && this.locCoords && this.homeCoords.lat && this.homeCoords.lng && this.locCoords.lat && this.locCoords.lng) {
                var distance = geolib.getDistance({
                    "latitude": this.homeCoords.lat,
                    "longitude": this.homeCoords.lng
                }, {
                    "latitude": this.locCoords.lat,
                    "longitude": this.locCoords.lng
                });

                if (distance) {
                    this.fbRefLoc.parent().child('isSeen').set(moment().tz("Europe/Zurich").format('MMM Do YYYY, H:mm'));
                    this.distanceUpdate = Date.now();
                    console.log('distance update: ' + this.distanceUpdate);
                    var userRef = this.fbRefLoc.parent().child('byDistance');
                    userRef.child('updated').set(moment().tz("Europe/Zurich").format('MMM Do YYYY, H:mm'));
                    userRef.child('directDistance').set(distance);
                    this.directDistance = distance;
                    this.calculateETA();
                    this.checkHomeAway();
                    userRef.child('directDistanceText').set(distance + " m");
                }
            }
        }
    }, this);
}

Geolocation.prototype.checkHomeAway = function() {

    if (this.homeRegionSeen) {
        if (this.insideHomeRegion !== null && this.homeRegionDate !== null) {

            if (this.homeRegionDate > this.travelTimeUpdate) {
                this.fbResident.child('isAway').set(!this.insideHomeRegion);
                log.info({
                    home: this.homeId,
                    user: this.userId
                }, ' Geolocation: Resident isAway: ' + this.insideHomeRegion + ' by region ');
            } else {
                if (this.eta <= this.maxEtaForAtHome) {
                    this.fbResident.child('isAway').set(false);
                    log.info({
                        home: this.homeId,
                        user: this.userId
                    }, ' Geolocation: Resident isAway: false by eta ');
                } else {
                    this.fbResident.child('isAway').set(true);
                    log.info({
                        home: this.homeId,
                        user: this.userId
                    }, ' Geolocation: Resident isAway: true by eta of ' + this.eta);
                }
            }
        } else {
            log.warn({
                home: this.homeId,
                user: this.userId
            }, ' Geolocation: HomeRegion isInside or homeRegionDate field are not set! Strange! ');
        }
    } else {
        if (this.eta <= this.maxEtaForAtHome) {
            this.fbResident.child('isAway').set(false);
            log.info({
                home: this.homeId,
                user: this.userId
            }, ' Geolocation: Resident is at home by ETA');
        } else {
            this.fbResident.child('isAway').set(true);
            log.info({
                home: this.homeId,
                user: this.userId
            }, ' Geolocation: Resident is not at home by ETA of ' + this.eta);
        }
    }

};

Geolocation.prototype.calculateETA = function() {
    var self = this;

    if (this.travelTimeUpdate > 0 && this.regionUpdate > 0) {
        console.log('calculate eta');
        if (this.travelTimeUpdate >= this.regionUpdate - 1) {
            this.fbResident.child('eta').set(this.travelEta);
            this.fbResident.child('eta-reason').set('traveltime-update');
            log.info({
                home: self.homeId,
                user: self.userId
            }, ' Geolocation: ETA is set by travel time event');
        } else if (this.regionUpdate > this.travelTimeUpdate) {
            console.log('by region');
            if (this.isCloserThan <= this.maxDistanceForDirectRegionUpdates) {
                var newEta = this.calculateETAforRegions();
                this.fbResident.child('eta').set(newEta);
                this.fbResident.child('eta-reason').set('region-update (close area)');
                log.info({
                    home: self.homeId,
                    user: self.userId
                }, ' Geolocation: ETA is set by region events of the closeby area');
            } else {
                if (this.regionUpdate > this.travelTimeUpdate + this.delayTimeToPrioritiseTravelTimeUpdates) {
                    var newEta2 = this.calculateETAforRegions();
                    this.fbResident.child('eta').set(newEta2);
                    this.fbResident.child('eta-reason').set('region-update (far away area)');
                    log.info({
                        home: self.homeId,
                        user: self.userId
                    }, ' Geolocation: ETA is set by region events of the more far away area');
                } else {
                    log.info({
                        home: self.homeId,
                        user: self.userId
                    }, ' Geolocation: a region is event is omitted on purpose');
                }
            }
        } else {
            log.info({
                home: self.homeId,
                user: self.userId
            }, ' Geolocation: ETA calc not possible! Should not happen');
        }

    } else {
        log.info({
            home: self.homeId,
            user: self.userId
        }, ' Geolocation: ETA can not be calculated since there are no location updates');
    }



};

Geolocation.prototype.calculateETAforRegions = function() {
    var etaForRegions = 0;
    if (this.isCloserThan !== 90000000) {
        etaForRegions = Math.round(this.isCloserThan / this.avgTravelSpeedForRegionsETA);
    } else if (this.isFarerThan !== 0) {
        etaForRegions = Math.round(this.isFarerThan / this.avgTravelSpeedForRegionsETA);
    } else {
        log.warn({
            home: this.homeId,
            user: this.userId
        }, ' Geolocation: no regions available --> we set eta to 0 min');
        etaForRegions = 0;
    }
    return etaForRegions;
};

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
};

Geolocation.prototype.setFbRefOff = function() {
    this.fbResident.child('eta').off();
    this.fbRefRegions.off();
    this.fbRefHome.off();
    this.fbRefLoc.off();
};



module.exports = Geolocation;
