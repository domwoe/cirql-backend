/**
 * Heating controlloer class
 *
 */

'use strict';

var Firebase = require('firebase');
var bunyan = require('bunyan');

var log = bunyan.createLogger({name: 'cirql-backend'});

/** Require configuration file */
var config = require('../config.json');
var fbBaseUrl = config.firebase;

var moment = require('moment-timezone');
moment().tz("Europe/Zurich").format();

function Heating(homeId, roomId) {
  this.homeId = homeId;
  this.roomId = roomId;
  /** The following values will be observed */
  this.mode = null;
  this.isAutoAway = null;
  this.temperature = null;
  this.eta = null;
  this.virtualTarget = null;
  this.heatupFactor = null;
  this.schedule = {};
  this.autoSchedule = {};
  /** The following values will be set */
  this.status = null;
  this.realTarget = null;
  this.nextTarget = null;

  var fbRef = new Firebase(fbBaseUrl+'homes/'+this.homeId+'/rooms/'+this.roomId);
  fbRef.child('mode').on('value', function(fbMode) {
  	var mode = fbMode.val();
  	this.mode = mode;
  	switch (mode) {
  		case 'manual':
  			break;
  		case 'schedule':
  			this.planNextTarget();
  			break;
  	}

  }, this);

  fbRef.child('isAutoAway').on('value', function(fbData) {
  	this.isAutoAway = fbData.val();
  }, this);

  fbRef.child('temperature').on('value', function(fbData) {
  	this.temperature = fbData.val();
  }, this);

  fbRef.child('eta').on('value', function(fbData) {
  	this.eta = fbData.val();
  }, this);

  fbRef.child('virtualTarget').on('value', function(fbData) {
  	this.virtualTarget = fbData.val();
  }, this);

  fbRef.child('heatupFactor').on('value', function(fbData) {
  	this.heatupFactor = fbData.val();
  }, this);

  fbRef.child('schedules').child('schedule').on('value', function(fbData) {
  	this.schedule = fbData.val();
  	this.planNextTarget();
  }, this);

  fbRef.child('schedules').child('autoSchedule').on('value', function(fbData) {
  	this.autoSchedule = fbData.val();
  }, this);

}



Heating.prototype.planNextTarget = function() {
  	if (this.schedule) {
  	  var self = this;
	  var now = moment();
	  var year = now.year();
	  var week = now.week();
	  var weekday = now.weekday();
	  var hour = now.hour();
	  var minute = now.minute();

	  var diff = 0;
	  var minDiff = 99999999999;

	  var target = null;

	  for (var ii = 0; ii < self.schedule.length; ii++) {
	  	(function(i) {

	  	var item = self.schedule[i];

	  	var itemMoment = moment({
	  								day: item.weekday,
	  								hour: item.hour,
	  								minute: item.minute
	  							});
	  	var nowMoment = moment({
	  								day: weekday,
	  								hour: hour,
	  								minute: minute
	  							});

	  	if (itemMoment.diff(nowMoment) > 0) {
	  		item.date = moment({
	  							year: year, 
	  							week: week, 
	  							weekday: item.weekday, 
	  							hour: item.hour, 
	  							minute: item.minute
	  						});
	  		diff = itemMoment.diff(nowMoment);
	  	}
	  	else {
	  		if (week == 51) {
	  			week = -1;
	  			year = year + 1
	  		}
	  		item.date = moment({
	  							year: year, 
	  							week: week + 1, 
	  							weekday: item.weekday, 
	  							hour: item.hour, 
	  							minute: item.minute
	  						});
	  		diff = item.date.diff(now);	
	  		console.log(now.week());
	  		console.log(now.week);
	  	}

	  	if (diff < minDiff) minDiff = diff;
	  	target = item.target;
	  }(ii))
	  }

	 
	 if (target != null) {

	 	(function() {
	 		setTimeout(self.setTarget,diff,target);
	 	})();	
	 }
	 
	}  

};

Heating.prototype.setTarget = function(target) {
	
	this.realTarget = target;
	
	var fbRef = new Firebase(fbBaseUrl+'homes/'+this.homeId+'/rooms/'+this.roomId);

	fbRef.child('realTarget').set(target);

};


module.exports = Heating;