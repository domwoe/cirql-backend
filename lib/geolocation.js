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

    /**
     * Utility function to convert a coordination
     * object in a string consisting of lat and lon.
     * This is needed for the google maps api.
     * @param  {object} coords
     * @return {string}
     */
    function coords2string(coords) {
        var coordsAsString = coords.lat + ',' + coords.lng;
        return coordsAsString;
    }

    var sLocCoords = coords2string(locCoords);
    var sHomeCoords = coords2string(homeCoords);

    // Tells google maps that the location coordinates stems from a
    // sensor device
    var sensor = true;

    console.log(sLocCoords);
    gm.distance(sLocCoords, sHomeCoords, function(err, data) {
  			if (data.hasOwnProperty('rows') && data.rows[0].hasOwnProperty('elements')) {
  				callback(null, data.rows[0].elements[0]);
  			}
  			else {
  				callback(err, data);
  			}
           
        },
        sensor, mode);
};

Geolocation.prototype.setFbRefOff = function() {
  // this.fbRef.child('name').off();
  // this.fbRef.child('isAway').off();
  // log.info({home: this.homeId, room: this.id}, ' User: All fbRefs are set to off');
};



module.exports = Geolocation;