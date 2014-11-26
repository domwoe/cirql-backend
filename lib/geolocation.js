/**
 * Geolocation class
 *
 */

/*jslint node: true */
'use strict';


var Firebase = require('firebase');
var bunyan = require('bunyan');
var bunyanLogentries = require('bunyan-logentries');

var log = bunyan.createLogger({
  name: "backend",
  streams: [
    {
            stream: process.stdout,
            level: "info"
        },
    {
      level: 'info',
      stream: bunyanLogentries.createStream({token: 'e103b6d1-907f-4cc7-83b4-8908ef866522'}),
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
    
    // Example coordiantes
    // Should be retrieved from firebase 
    
    this.fbRefHome = new Firebase(fbBaseUrl+'homes/'+this.homeId+'/homelocation/');

    this.fbRefHome.on('value', function(fbData) {
      if(fbData.val()) {
        this.homeCoords = {};
        this.homeCoords.lat = fbData.val().lat;
        this.homeCoords.lng = fbData.val().lng;
      }
    },this);

    this.fbRefLoc = new Firebase(fbBaseUrl+'homes/'+this.homeId+'/residents/'+this.userId+'/lastLocation/');

    this.fbRefLoc.on('value', function(fbData) {
      if(fbData.val()) {
        this.locCoords = {};
        this.locCoords.lat = fbData.val().lat;
        this.locCoords.lng = fbData.val().lon;

        var coordsstrings = this.coords2string(this.locCoords);
        var self = this;
        gm.reverseGeocode(coordsstrings, function(err, data){
            if(err) {
              log.warn({home: self.homeid, user: self.userId}, ' Geolocation: Reverse Geocoding of last location failed 1');
            }
            if(data) {
              if(data.status === 'OK') {
                var results = data.results[0];
                log.info({home: self.homeId, user: self.userId}, ' Geolocation: Current Location is ' + results.formatted_address);
                self.fbRefLoc.child("formatted_address").set(results.formatted_address);
              }
              else {
                 log.warn({home: self.homeId, user: self.userId}, ' Geolocation: Reverse Geocoding of last location failed 2');
              }
            }
        });

        if(this.homeCoords && this.locCoords){
        this.getTravelTime(this.homeCoords, this.locCoords, 'driving', function(err,data){
          if(err) {
            log.warn({home: self.homeId, user: self.userId}, ' Geolocation: Traveltime calc failed with error ' + err);
          }
          if(data) {
            console.log(JSON.stringify(data));
            var userRef = self.fbRefLoc.parent();
            userRef.child('distance').set(data.distance.value);
            userRef.child('distanceText').set(data.distance.text);
            userRef.child('etaText').set(data.duration.text);
            userRef.child('etaValue').set(data.duration.value);
            log.info({home: self.homeId, user: self.userId}, ' Geolocation: Resident has eta of ' + data.duration.text + ' with distance ' + data.distance.text);
          }
        });
        }
      }
    },this);   
}

/**
 * Calculates direct distance between two coordinates
 * @param  {object} locCoords
 * @param  {object} homeCoords
 * @return {integer} distance in km
 */
Geolocation.prototype.getDirectDistance = function(locCoords, homeCoords) {

    function deg2rad(deg) {
        return deg * (Math.PI / 180);
    }

    var R = 6371; // Radius of the earth in km
    var dLat = deg2rad(locCoords.lat - homeCoords.lat); // deg2rad below
    var dLng = deg2rad(locCoords.lng - homeCoords.lng);
    var a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(deg2rad(locCoords.lat)) * Math.cos(deg2rad(homeCoords.loc)) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    var d = R * c; // Distance in km
    return d;

};

/**
 * Return distance and travel time between locCoords and homeCoords for a 
 * specified travel mode
 * @param  {object}   locCoords
 * @param  {object}   homeCoords
 * @param  {string}   mode (can be walking, driving or transit)
 * @param  {Function} callback = function(err,data) where data is object
 * example:  	{ distance: { text: '2.2 km', value: 2234 },
 *  			  duration: { text: '23 mins', value: 1367 },
 *  			  status: 'OK' }
 */
Geolocation.prototype.getTravelTime = function(locCoords, homeCoords, mode, callback) {


    var sLocCoords = this.coords2string(locCoords);
    var sHomeCoords = this.coords2string(homeCoords);

    // Tells google maps that the location coordinates stems from a
    // sensor device
    var sensor = true;

   // console.log(sLocCoords);
    gm.distance(sLocCoords, sHomeCoords, function(err, data) {
        if(err) {
          log.warn({home: this.homeid, user: this.userId}, ' Geolocation: gm.distance calculation failed with: ' + err);
        }
        if(data) {
  			if (data.hasOwnProperty('rows') && data.rows[0].hasOwnProperty('elements')) {
  				callback(null, data.rows[0].elements[0]);
  			}
  			else {
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