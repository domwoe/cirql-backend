/**
 * Heating controller class
 *
 */

/*jslint node: true */
'use strict';

var Firebase = require('firebase');
var bunyan = require('bunyan');

var log = bunyan.createLogger({name: 'cirql-backend'});

var _ = require('underscore');

/** Require configuration file */
var config = require('../config.json');
var fbBaseUrl = config.firebase;

var moment = require('moment-timezone');
moment().tz("Europe/Zurich").format();

/** Maximal heatupTime */
var HEATUPLIMIT = 60;

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
  this.hasPreheat = null;
  /** The following values will be set */
  this.status = null;
  this.realTarget = null;
  this.nextScheduledTarget = null;
  this.currentScheduledTarget = null;


  this.nextTargetTimer = null;

  log.info('Heating FirebaseRef: '+fbBaseUrl+'homes/'+this.homeId+'/rooms/'+this.roomId);
  var fbRef = new Firebase(fbBaseUrl+'homes/'+this.homeId+'/rooms/'+this.roomId);

  /** Init */
  fbRef.once('value', function(fbData) {
  	this.mode = fbData.child('mode').val();
  	this.isAutoAway = fbData.child('isAutoAway').val();
  	this.temperature = fbData.child('temperature').val();
  	this.eta = fbData.child('eta').val();
  	this.virtualTarget = fbData.child('virtualTarget').val();
  	this.heatupFactor = fbData.child('heatupFactor').val();
  	this.schedule = fbData.child('schedules').child('schedule').val();
  	this.autoSchedule = fbData.child('schedules').child('autoSchedule').val();
  	this.hasPreheat = fbData.child('hasPreheat').val();

  	switch (this.mode) {
  		case 'manual':
  			this.setTarget(this.virtualTarget);
  			break;
  		case 'schedule':
  			var schedule = null;
  			if (this.isAutoAway) {
  				schedule = this.autoSchedule;
  			}
  			else {
  				schedule = this.schedule;
  			}
  			var self = this;
  			findScheduleItem(schedule, 'last', function(e, objLastItem) {
	  			if (e) {
					log.warn(e);
					return;
				}	
				var target = schedule[objLastItem.index].target;
				self.currentScheduledTarget = target;
				self.setTarget(target);

  			});
  			this.planNextTarget();
  			this.setStatus();
  			break;
  	}

  }, this);


  /** Listeners */

  fbRef.child('mode').on('value', function(fbMode) {
  	var mode = fbMode.val();
  	this.mode = mode;
  	switch (mode) {
  		case 'manual':
  			this.setTarget(this.virtualTarget);
  			break;
  		case 'schedule':
  			this.planNextTarget();
  			this.setStatus();
  			break;
  	}

  }, this);

  fbRef.child('isAutoAway').on('value', function(fbData) {

  		this.isAutoAway = fbData.val();
  		this.planNextTarget();

  }, this);

  fbRef.child('temperature').on('value', function(fbData) {
    log.info('Temperature change: '+fbData.val());
  	this.temperature = fbData.val();
  	this.planNextTarget();
  	
  }, this);

  fbRef.child('eta').on('value', function(fbData) {
  	this.eta = fbData.val();
  	this.planNextTarget();
  		
  }, this);

  fbRef.child('virtualTarget').on('value', function(fbData) {
  	var first = true;
  	if (!first) {
  		this.virtualTarget = fbData.val();
  		this.setTarget(this.virtualTarget);
  		this.currentScheduledTarget = this.virtualTarget;
  	}
  	first = false;		
  }, this);

  fbRef.child('heatupFactor').on('value', function(fbData) {
  	this.heatupFactor = fbData.val();
  	this.planNextTarget();
  }, this);

  fbRef.child('schedules').child('schedule').on('value', function(fbData) {
  	this.schedule = fbData.val();
  	this.planNextTarget();
  }, this);

  fbRef.child('schedules').child('autoSchedule').on('value', function(fbData) {
  	this.autoSchedule = fbData.val();
  	this.planNextTarget(); 		
  }, this);

}


/** Sets a timer to set next target temperature */
Heating.prototype.planNextTarget = function() {
	var self = this;
	var heatupTime = 0;
	var timeTillNextTarget = null;
	var target = null;
	var aaTarget = null;
	var schedule = {};

	if (self.mode == 'schedule') {

		if (self.isAutoAway) {
			schedule = self.autoSchedule;
		}	
		else {
			schedule = self.schedule;
		}

		findScheduleItem(schedule, 'next',function(e, objNextItem) {
			if (e) {
				log.warn(e);
				return;
			}	
			timeTillNextTarget = objNextItem.time;
			target = schedule[objNextItem.index].target;
			self.nextScheduledTarget = target;
			
			/** Consider heatupTime */
			if (self.hasPreheat) {
				heatupTime = calcHeatupTime(self.temperature, self.heatupFactor, target);
			 	timeTillNextTarget = timeTillNextTarget - heatupTime;
			}

			/** Room is unoccupied */
			if (self.isAutoAway && self.eta > 0) {
				if ( timeTillNextTarget <= 0 ) {
					aaTarget = calcAutoAwayTarget(self.eta, this.temperature, this.nextScheduledTarget);
				}
				else {
					aaTarget = calcAutoAwayTarget(self.eta, self.temperature, self.currentScheduledTarget);
				}

				self.setTarget(aaTarget);
			}
			
			/** Room is occupied */
			else {
				
				/** schedule next target */
			 	(function(self) {
			 		clearTimeout(self.nextTargetTimer);
			 		self.nextTargetTimer = setTimeout(
			 			function(target) {
			 				self.currentScheduledTarget = target;
			 				self.setTarget.bind(self);
			 			},timeTillNextTarget,target);
			 	})(self);

			}
	
		});

	}
  	
};

Heating.prototype.setTarget = function(target) {

	if (target !== null) {
		this.realTarget = target;
		
		var fbRef = new Firebase(fbBaseUrl+'homes/'+this.homeId+'/rooms/'+this.roomId);

		fbRef.child('realTarget').set(target);
	}	

};

Heating.prototype.setStatus = function() {

	var fbRef = new Firebase(fbBaseUrl+'homes/'+this.homeId+'/rooms/'+this.roomId);

	var status = null;

	if (this.mode == 'schedule') {
		/* AutoAway modus is active */
		if (this.isAutoAway) {
			/** Residents are away */
			if (this.eta > 0) {
				status = 'away';
			}
			/** Room is occupied */
			else {
				/** is preheating */
				if (this.realTarget > this.virtualTarget) {
					status = 'preheating';
				}
				else {
					status = 'normal';
				}
			}
		}
		/** Regular schedule is active */
		else {
			/** is preheating */
			if (this.realTarget > this.virtualTarget) {
				status = 'preheating';
			}
			else {
				status = 'normal';
			}

		}
	}
	/** Manual Mode */
	else {

	}

	this.status = status;

	fbRef.child('status').set(status);

};

/**
 * Calculate time it takes to heat up to nextTarget
 */
function calcHeatupTime(temperature,heatupFactor, nextTarget) {
	
	var heatupTime = temperature + heatupFactor * ( nextTarget - temperature );
	if (heatupTime > HEATUPLIMIT) return HEATUPLIMIT;
	else return heatupTime;
}

/**
 * Finds last or next (as specified by which) schedule item.
 * Callback functions has to be in the form function(error, {index, time})
 * where index is the index of schedule where wanted item can be found
 * and time is the time in ms from now until that event (only for next)
 */
function findScheduleItem(schedule, which, cb) {
  if (!_.isEmpty(schedule)) {
	  var now = moment();
	  var year = now.year();
	  var week = now.week();
	  var weekday = now.weekday();
	  var day = now.date();
	  var hour = now.hour();
	  var minute = now.minute();

	  var timeTillItem = 0;
	  var timeTillWantedItem = 99999999999;

	  var index = null;

	  var target = null;

	  for (var ii = 0; ii < schedule.length; ii++) {
	  	//(function(i) {

	  	var item = schedule[ii];

	  	var delta = item.weekday - weekday;

	  	item.day = day + delta;

	  	var itemMoment = moment({
	  								day: item.day,
	  								hour: item.hour,
	  								minute: item.minute
	  							});

	  	timeTillItem = itemMoment.diff(now);

	  	if (which == 'last') {
	  		/** Add a week in ms if item is before today */
	  		if ( timeTillItem < 0 ) timeTillItem += 7*24*60*60*1000; 

	  	}
	  	else if (which == 'next') {
	  		if ( timeTillItem > 0 ) timeTillItem -= 7*24*60*60*1000; 
	  		timeTillItem = -timeTillItem;
	  	}

	  	if (timeTillItem < timeTillWantedItem) {
	  		timeTillWantedItem = timeTillItem;
	  		index = ii;

	  	}

	    //}(ii))
	  }
	   log.info('Time till wanted item: '+(timeTillWantedItem/1000/60).toFixed(0));
	   cb(null, { index: index, time: timeTillWantedItem });
  }
  //cb(new Error('Schedule is empty'), null);  
}

function calcAutoAwayTarget(eta, temperature, scheduledTarget) {
// TODO - Calculate auto away target based on scheduled Target	
	var target = null;
	return target;

}


module.exports = Heating;