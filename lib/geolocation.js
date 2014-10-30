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

function Geolocation(user,home) {
  
  this.user = user;
  this.home = home;

  // this.homeCoords = {
  // 	lat: ...,
  // 	lon:
  // };


}

/**
 * Calculates direct distance between two coordinates
 * @param  {object} locCoords
 * @param  {object} homeCoords
 * @return {integer} distance in km
 */
Geolocation.prototype.getDirectDistance = function(locCoords, homeCoords) {

  var R = 6371; // Radius of the earth in km
  var dLat = deg2rad(locCoords.lat-homeCoords.lat);  // deg2rad below
  var dLon = deg2rad(locCoords.lon-homeCoords.lon); 
  var a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(deg2rad(locCoords.lat)) * Math.cos(deg2rad(homeCoords.loc)) * 
    Math.sin(dLon/2) * Math.sin(dLon/2)
    ; 
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
  var d = R * c; // Distance in km
  return d;


  function deg2rad(deg) {
    return deg * (Math.PI/180);
  }
};

/**
 * @param  {object}   locCoords
 * @param  {object}   homeCoords
 * @param  {string}   mode
 * @param  {Function} callback
 */
Geolocation.prototype.getTravelTime = function(locCoords,homeCoords,mode,callback) {
	
	var locCoords = coords2string(locCoords);
	var homeCoords = coords2string(homeCoords);

	// Tells google maps that the location coordinates stems from a
	// sensor device
	var sensor = true;

	gm.distance(locCoords,homeCoords, function(err, data) {
		callback(err, data);
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
function coords2string(coords) {
	var coordsAsString = coords.lat+''+coords.lon;
	return coordsAsString;
}


module.exports = Geolocation;
