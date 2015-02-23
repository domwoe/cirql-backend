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
    this.lastLocCoords = null;

    this.locCoords = null;
    this.regions = null;

    this.avgTravelSpeedForRegionsETA = 1000; // 1000 meter/minute  = 60 kmh
    this.maxDistanceForAtHome = 300; // in metres
    this.delayTimeToPrioritiseTravelTimeUpdates = 900; // 15 minutes

    this.minTravelEtaForOverrides = 10;
    this.maxTravelEtaForOverrideHomeRegion = 3;

    this.eta = 0;

    this.regionUpdate = 0;
    this.regionEta = null;

    this.isCloserThan = 90000000;
    this.isFarerThan = 0;

    this.travelTimeUpdate = 0;
    this.travelEta = 0;

    this.homeRegionSeen = false;
    this.insideHomeRegion = false;
    this.homeRegionDate = null;

    this.etaHistoryEnabled = false;

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


    this.fbGeolocationParams.child('maxDistanceForAtHome').on('value', function(param) {
        if (param.val()) {
            this.maxDistanceForAtHome = param.val();
            log.info({
                home: this.homeId,
                user: this.userId
            }, ' Geolocation: maxDistanceForAtHome is set to ' + param.val());
        }
    }, this);




    // Example coordiantes
    // Should be retrieved from firebase 
    this.fbResident = new Firebase(fbBaseUrl + 'homes/' + this.homeId + '/residents/' + this.userId + '/');

    this.fbResident.once('value', function(fbInitData) {
        this.regionUpdate = moment(fbInitData.child('byRegion').child('updated').val());
        this.regionEta = fbInitData.child('byRegion').child('eta').val();
        this.travelTimeUpdate = moment(fbInitData.child('byTravelTime').child('updated').val());
        this.travelEta = fbInitData.child('byTravelTime').child('eta').val();
        this.eta = fbInitData.child('eta').val();
        this.regions = fbInitData.child('lastRegions').val();
    }, this);

    this.fbResident.child('etaHistoryEnabled').on('value', function(fbData) {
        if (fbData.val() === true) {
            this.etaHistoryEnabled = true;
        } else {
            this.etaHistoryEnabled = false;
            this.fbResident.child('eta-history').set(null);
        }
    }, this);

    this.fbResident.child('eta').on('value', function(fbData) {
        if (fbData.val()) {
            this.eta = fbData.val();
            this.checkHomeAway();
        }
    }, this);

    this.fbRefHome = new Firebase(fbBaseUrl + 'homes/' + this.homeId + '/homelocation/');

    this.fbRefHome.on('value', function(fbData) {
        if (fbData.val()) {
            this.homeCoords = {};
            this.homeCoords.lat = fbData.val().lat;
            this.homeCoords.lng = fbData.val().lng;
        }
    }, this);

    this.fbRefLastLocationByUser = new Firebase(fbBaseUrl + 'homes/' + this.homeId + '/residents/' + this.userId + '/lastLocationByUser/');
    this.fbRefRegions = new Firebase(fbBaseUrl + 'homes/' + this.homeId + '/residents/' + this.userId + '/lastRegions/');


    this.fbRefLastLocationByUser.on('value', function(fbLastLoc) {
        if (fbLastLoc.val()) {
            this.lastLocCoords = {};
            this.lastLocCoords.lat = fbLastLoc.val().lat;
            this.lastLocCoords.lng = fbLastLoc.val().lng;
            this.lastLocDate = moment(fbLastLoc.val().date).unix();

            if (this.lastLocDate > moment().unix() - 5 * 60) {
                if (this.homeCoords !== null) {
                    var distance = geolib.getDistance({
                        "latitude": this.homeCoords.lat,
                        "longitude": this.homeCoords.lng
                    }, {
                        "latitude": this.lastLocCoords.lat,
                        "longitude": this.lastLocCoords.lng
                    });
                    if (this.regions !== null) {
                        var someRegionChanged = false;
                        for (var regionKey in this.regions) {
                            var region = this.regions[regionKey];
                            if (distance < region.radius) {
                                if (region.isInside === false) {
                                    someRegionChanged = true;
                                    var date = new Date();
                                    date = date + '';
                                    this.regions[regionKey].date = date;
                                    this.regions[regionKey].isInside = true;
                                    this.regions[regionKey]['overwrite'] = true;
                                    
                                    if (regionKey === 'reg1') {
                                        log.warn({
                                            home: this.homeId,
                                            user: this.userId
                                        }, ' Geolocation-HomeRegion-Overwrite: It was set to at home by lastLocByUser with distance ' + distance);
                                    } else {
                                        log.warn({
                                            home: this.homeId,
                                            user: this.userId
                                        }, ' Geolocation-Region-Overwrite: Region-' + this.regions[regionKey].radius + ' was set to Inside by lastLocByUser with distance ' + distance);
                                    }
                                }
                            } else {
                                if (region.isInside === true) {
                                    someRegionChanged = true;
                                    var date1 = new Date();
                                    date1 = date1 + '';
                                    this.regions[regionKey].date = date1;
                                    this.regions[regionKey].isInside = false;
                                    this.regions[regionKey]['overwrite'] = true;

                                    if (regionKey === 'reg1') {
                                        log.warn({
                                            home: this.homeId,
                                            user: this.userId
                                        }, ' Geolocation-HomeRegion-Overwrite: It was set to away by lastlocbyUser with distance ' + distance);
                                    } else {
                                        log.info({
                                            home: this.homeId,
                                            user: this.userId
                                        }, ' Geolocation-Region-Overwrite: Region-' + this.regions[regionKey].radius + ' was set to Outside by lastLocByUser with distance ' + distance);
                                    }
                                }
                            }
                        }
                        if (someRegionChanged === true) {
                            this.fbRefRegions.set(this.regions);
                        }
                    } else { // no region update at all, set home/away
                        var isInside = false;
                        if (distance < this.maxDistanceForAtHome) {
                            isInside = true;
                        } else {
                            isInside = false;
                        }
                        var date2 = new Date();
                        date2 = date2 + '';
                        var currhomeregion = {
                            'date': date2,
                            'radius': this.maxDistanceForAtHome,
                            'isInside': isInside
                        };
                        this.fbRefRegions.child('reg1').set(currhomeregion);
                        log.info({
                            home: this.homeId,
                            user: this.userId
                        }, ' Geolocation-HomeRegion-Init: It was initialized to isInside: ' + isInside + ' by lastLocByUser');
                    }
                }
            }
        }
    }, this);

    this.fbRefRegions.on('value', function(fbRegions) {
        if (fbRegions.val() !== null) {
            this.regions = fbRegions.val();
            //FIRST check home region
            if (this.regions.reg1) {
                this.homeRegionSeen = true;
                this.homeRegionDate = moment(this.regions.reg1.date).unix();
                var farAwayRegionChanged = false;
                if (this.regions.reg1.isInside === true) {
                    for (var regionKey1 in this.regions) {
                        var currRegion1 = this.regions[regionKey1];
                        var currRegionDate1 = moment(currRegion1.date).unix();
                        if (regionKey1 !== "reg1") {
                            if (currRegionDate1 > this.homeRegionDate + 5 * 60) {
                                if (currRegion1.isInside === false) {
                                    farAwayRegionChanged = true;
                                } else if (currRegion1.isInside === true) {
                                    farAwayRegionChanged = true;
                                }
                            }
                        }
                    }
                    if (!farAwayRegionChanged) {
                        this.insideHomeRegion = true;
                    } else {
                        this.insideHomeRegion = false;
                        var date = new Date();
                        date = date + '';
                        this.fbRefRegions.child('reg1').set({
                            'date': date,
                            'isInside': false,
                            'radius': this.regions.reg1.radius
                        });
                        log.warn({
                            home: this.homeId,
                            user: this.userId
                        }, ' Geolocation-HomeRegion-Overwrite: Reg1 was overwritten by another RegionUpdate');
                    }
                } else if (this.regions.reg1.isInside === false) {
                    this.insideHomeRegion = false;
                } else {
                    log.warn({
                        home: this.homeId,
                        user: this.userId
                    }, ' Geolocation: Should not happen');
                }
            } else {
                this.homeRegionSeen = false;
                this.insideHomeRegion = false;
            }

            this.isCloserThan = 90000000;
            this.isFarerThan = 0;
            var somethingIsFar = false;
            var somethingIsClose = false;
            var mostRecentDate = 0;
            for (var regionKey in this.regions) {

                var currRegion = this.regions[regionKey];
                var currRegionDate = moment(currRegion.date).unix();
                if (currRegionDate >= mostRecentDate - 15 * 60) {
                    mostRecentDate = currRegionDate;
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
            this.calculateETAforRegions();
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
                        home: self.homeId,
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
                                //   console.log('travel time update: ' + self.travelTimeUpdate);
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
        }
    }, this);
}

Geolocation.prototype.checkHomeAway = function() {

    if (this.homeRegionSeen === true) {
        if (this.insideHomeRegion !== null && this.homeRegionDate !== null) {
            if (this.insideHomeRegion === true) {
                this.fbResident.child('isAway').set(false);
                log.info({
                    home: this.homeId,
                    user: this.userId
                }, ' Geolocation: Resident is at home by home-region ');
            } else if (this.insideHomeRegion === false) {
                this.fbResident.child('isAway').set(true);
                log.info({
                    home: this.homeId,
                    user: this.userId
                }, ' Geolocation: Resident is away by home-region ');
            }

        } else {
            log.warn({
                home: this.homeId,
                user: this.userId
            }, ' Geolocation-Warning: HomeRegion isInside or homeRegionDate field are not set! Strange! ');
        }
    } else {
        this.fbResident.child('isAway').set(true);
        log.info({
            home: this.homeId,
            user: this.use
        }, ' Geolocation: Resident is not at home since home-region is not yet set');

    }
};


Geolocation.prototype.calculateETA = function() {
    var date = new Date();
    var timestamp = date.toString();
    if (this.regionEta !== null) {
        if (this.regionEta < this.minTravelEtaForOverrides) {
            this.eta = this.regionEta;
            this.fbResident.child('eta').set(this.regionEta);
            this.fbResident.child('eta-reason').set('region-update (close area)');
            if (this.etaHistoryEnabled) {
                this.fbResident.child('eta-history').push({
                    'eta': this.regionEta,
                    'eta-reason': 'region-update (close area)',
                    'date': timestamp
                });
            }
        } else {
            if (this.travelTimeUpdate >= this.regionUpdate - this.delayTimeToPrioritiseTravelTimeUpdates) {
                this.eta = this.travelEta;
                this.fbResident.child('eta').set(this.travelEta);
                this.fbResident.child('eta-reason').set('traveltime-update (far area)');
                if (this.etaHistoryEnabled) {
                    this.fbResident.child('eta-history').push({
                        'eta': this.travelEta,
                        'eta-reason': 'traveltime-update (far area)',
                        'date': timestamp
                    });
                }
            } else {
                this.eta = this.regionEta;
                this.fbResident.child('eta').set(this.regionEta);
                this.fbResident.child('eta-reason').set('region-update (far area)');
                if (this.etaHistoryEnabled) {
                    this.fbResident.child('eta-history').push({
                        'eta': this.regionEta,
                        'eta-reason': 'region-update (far area)',
                        'date': timestamp
                    });
                }
            }
        }
    } else if (this.travelEta !== null) {
        this.eta = this.travelEta;
        this.fbResident.child('eta').set(this.travelEta);
        this.fbResident.child('eta-reason').set('traveltime-update (init)');
        if (this.etaHistoryEnabled) {
            this.fbResident.child('eta-history').push({
                'eta': this.travelEta,
                'eta-reason': 'traveltime-update (init)',
                'date': timestamp
            });
        }

    } else {
        if (this.etaHistoryEnabled) {
            this.fbResident.child('eta-history').push({
                'eta': this.eta,
                'eta-reason': 'no location updates',
                'date': timestamp
            });
        }
        log.info({
            home: this.homeId,
            user: this.userId
        }, ' Geolocation: ETA can not be calculated since there are no location updates');
    }
};

Geolocation.prototype.calculateETAforRegions = function() {
    var etaForRegions = null;
    if (this.isCloserThan !== 90000000) {
        etaForRegions = Math.round(this.isCloserThan / this.avgTravelSpeedForRegionsETA);
    } else if (this.isFarerThan !== 0) {
        etaForRegions = Math.round(this.isFarerThan / this.avgTravelSpeedForRegionsETA);
    } else {
        log.warn({
            home: this.homeId,
            user: this.userId
        }, ' Geolocation-Warning: no regions available --> we set eta to 0 min');
        etaForRegions = null;
    }
    this.regionEta = etaForRegions;
    var userRef = this.fbRefRegions.parent();
    userRef.child('byRegion').child('eta').set(this.regionEta);
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
