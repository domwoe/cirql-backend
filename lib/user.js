/**
 * User class
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

  	log.info({home: this.homeId, user: this.id}, ' User: Initialized ');
  	this.fbRef = new Firebase(fbBaseUrl+'homes/'+this.homeId+'/residents/'+this.id);


this.fbRef.child('name').on('value', function(fbData) {
  log.info({home: this.homeId, user: this.id}, 'User has name: '+fbData.val());
  this.name = fbData.val();
},this);

this.fbRef.child('isAway').on('value', function(fbData) {
  if(fbData.val() != null) {
    log.info({home: this.homeId, user: this.id}, 'User ' +this.name +' isAway: '+fbData.val());
    this.isAway = fbData.val();
  }
  else {
    this.isAway = false;
    log.info({home: this.homeId, user: this.id}, 'User ' +this.name +' Initial isAway State is set to: ' + this.isAway);
  }
},this);

this.fbRef.child('allowsGeolocation').on('value', function(fbData) {
  log.info({home: this.homeId, user: this.id}, 'User ' +this.name +' allowsGeolocation: '+fbData.val());
  this.allowsGeo = fbData.val();
  if(this.allowsGeo.val() === true){
  	this.geolocation = new Geolocation(this.homeId, this.id);
  	log.info({home: this.homeId, user: this.id}, 'Geolocation activated for user ' +this.name);
  }
  else {
  	if(this.geolocation) {
  		this.geolocation.setFbRefOff();
  	}
  	this.geolocation = null;
  	log.info({home: this.homeId, user: this.id}, 'Geolocation deactivated for user ' +this.name);
  }
},this);


User.prototype.setFbRefOff = function() {
  this.fbRef.child('name').off();
  this.fbRef.child('isAway').off();
  log.info({home: this.homeId, room: this.id}, ' User: All FbRefs are set to off');
};

}

module.exports = User;
