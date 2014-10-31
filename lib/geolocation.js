/**
 * Geolocation class
 *
 */

/*jslint node: true */
'use strict';

/**
 * [Geolocation description]
 * @param {[integer]} user
 * @param {[integer]} home
 */

var gm = require('googlemaps');

function Geolocation(user, home) {

    this.user = user;
    this.home = home;

    
    // Example coordiantes
    // Should be retrieved from firebase 
    this.homeCoords = {
        lat: 47.381667,
        lon: 8.544128

    };


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
    var dLon = deg2rad(locCoords.lon - homeCoords.lon);
    var a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(deg2rad(locCoords.lat)) * Math.cos(deg2rad(homeCoords.loc)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    var d = R * c; // Distance in km
    return d;

};

/**
 * Return distance and travel time between locCoords and homeCoords for a 
 * specified travel model
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
        var coordsAsString = coords.lat + ',' + coords.lon;
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




module.exports = Geolocation;