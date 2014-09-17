/**
 * Netatmo class
 *
 */

/*jslint node: true */
'use strict';

var Firebase = require('firebase');
var bunyan = require('bunyan');

var log = bunyan.createLogger({name: 'cirql-backend'});

/** Require configuration file */
var config = require('../config.json');
var fbBaseUrl = config.firebase;

function Netatmo(homeId, roomId, theRoom) {
  this.homeId = homeId;
  this.roomId = roomId;

  this.fbRefRoomNetatmoLink = new Firebase(fbBaseUrl+'homes/'+this.homeId+'/rooms/'+this.roomId+'/sensors/netatmo/');
  log.info('RoomNetatmoLink FirebaseRef: '+this.fbRefRoomNetatmoLink);

  this.fbRefRoomNetatmoLink.once('value', function(fbRoomNetatmoLink) {
	this.station = ''+fbRoomNetatmoLink.child("station").val();
	this.module = ''+fbRoomNetatmoLink.child("module").val();

	this.fbRefNetatmo =  new Firebase(fbBaseUrl+'homes/'+this.homeId+'/sensors/netatmo/stations/'+this.station+'/modules/'+this.module+'/');
	log.info('Netatmo FirebaseRef: '+this.fbRefNetatmo);
	// Optimization: Implement a check if new Temperature is different to old one
	this.fbRefNetatmo.child('temperature').on('value', function(fbNetatmoTemperature){
		theRoom.setNetatmoTemperature(fbNetatmoTemperature.val());
	});
  },this);
}

Netatmo.prototype.setFbRefOff = function() {
	this.fbRefRoomNetatmoLink.off();
	this.fbRefNetatmo.child('temperature').off();
};

module.exports = Netatmo;
