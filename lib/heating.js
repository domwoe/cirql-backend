/**
 * Heating controller class
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
  // mode can be either manual or auto.
  // Maye be also off and holiday in the future
  this.mode = null;
  // Geolocation based heating feature
  this.isAutoAway = null;
  // Estimated arrival time of nearest resident
  this.eta = null;
  // Measured room temperature
  this.temperature = null;
  // Target temperature as shown in app
  this.virtualTarget = null;
  // Factor that tells how much time the room
  // needs to heat uo 1 degree
  // Only used if hasPreheat = true
  this.heatupFactor = null;
  // Schedule object of items
  this.schedule = {};
  
  // Preheat feature
  this.hasPreheat = null;

  /** The following values will be set */
  this.status = null;
  this.realTarget = null;
  this.nextScheduledTarget = null;
  this.currentScheduledTarget = null;


  this.nextTargetTimer = null;

  //log.info('Heating FirebaseRef: '+fbBaseUrl+'homes/'+this.homeId+'/rooms/'+this.roomId);
  log.info({home: this.homeId, room: this.roomId}, ' Heating: Initialized ');
  this.fbRef = new Firebase(fbBaseUrl+'homes/'+this.homeId+'/rooms/'+this.roomId);
  this.fbRefMode = this.fbRef.child('mode');
  this.fbRefIsAutoAway = this.fbRef.child('isAutoAway');
  this.fbRefTemperature =  this.fbRef.child('temperature');
  this.fbRefEta =  this.fbRef.child('eta');
  this.fbRefVirtualTarget = this.fbRef.child('virtualTarget');
  this.fbRefRealTarget = this.fbRef.child('realTarget');
  this.fbRefHeatupFactor = this.fbRef.child('heatupFactor');
  this.fbRefSchedule = this.fbRef.child('schedule');


  /** Init */
  this.fbRef.once('value', function(fbData) {
  	this.mode = fbData.child('mode').val();
  	this.isAutoAway = fbData.child('isAutoAway').val();
  	this.temperature = fbData.child('temperature').val();
  	this.eta = fbData.child('eta').val();
  	this.virtualTarget = fbData.child('virtualTarget').val();
  	this.heatupFactor = fbData.child('heatupFactor').val();
  	this.schedule = fbData.child('schedule').val();
  	this.hasPreheat = fbData.child('hasPreheat').val();

  	switch (this.mode) {
  		case 'manual':
  			this.setTarget(this.virtualTarget, ' initial  manual mode ');
  			break;
  		case 'auto':
  			var self = this;
  			this.findScheduleItem(this.schedule, 'previous', function(e, objLastItem) {
	  			if (e) {
					log.warn(e);
					return;
				}	
				var target = self.schedule[objLastItem.key].target;
				self.currentScheduledTarget = target;
				self.setTarget(target, ' initial auto mode ');
				self.setVirtualTarget(target, ' initial auto mode ');
				self.planNextTarget();
  				self.setStatus();
  			});
  			break;
  	}

  }, this);


  /** Listeners */

  this.fbRefMode.on('value', function(fbMode) {
  	var mode = fbMode.val();
  	this.mode = mode;
  	switch (mode) {
  		case 'manual':
  			this.setTarget(this.virtualTarget, ' manual mode ');
  			break;
  		case 'auto':
  			var self = this;
  			this.findScheduleItem(this.schedule, 'previous', function(e, objLastItem) {
	  			if (e) {
					log.warn(e);
					return;
				}	
				var target = self.schedule[objLastItem.key].target;
				self.currentScheduledTarget = target;
				self.setTarget(target, ' auto mode ');
				self.setVirtualTarget(target, ' initial auto mode ');
				self.planNextTarget();
  				self.setStatus();
  			});
  			break;
  	}
  	log.info({home: this.homeId, room: this.roomId}, ' Heating: Mode: ' + this.mode);

  }, this);

  this.fbRefIsAutoAway.on('value', function(fbData) {

  		this.isAutoAway = fbData.val();
  		this.planNextTarget();

  }, this);

  this.fbRefTemperature.on('value', function(fbData) {
    log.info({home: this.homeId, room: this.roomId}, 'Temperature change: '+fbData.val());
  	this.temperature = fbData.val();
  	this.planNextTarget();
  	
  }, this);

 this.fbRefEta.on('value', function(fbData) {
  	this.eta = fbData.val();
  	this.planNextTarget();
  		
  }, this);

  this.fbRefRealTarget.on('value', function(fbData) {
  	if(fbData.val !== null) {
  		this.realTarget = fbData.val();
    }
    // else {
    // 	this.fbRefRealTarget.set(21);
    // }

  },this);


  this.fbRefVirtualTarget.on('value', function(fbData) {
  	if(this.mode === 'manu') {
  		this.virtualTarget = fbData.val();
  		if(this.realTarget !== this.virtualTarget) {
  			this.setTarget(this.virtualTarget, ' change of virtual target in manual mode');
  		}
  	}
  	else if (this.mode === 'auto') {
  		this.virtualTarget = fbData.val();
  		if(this.realTarget !== this.virtualTarget) {
  			this.setTarget(this.virtualTarget, ' change of virtual target in auto mode');
  			this.currentScheduledTarget = this.virtualTarget;
  		}
  	}
  	else {
  		log.warn({home: this.homeId, room: this.roomId}, ' Heating: Unknown mode: ' + this.mode);
  	}	
  }, this);

  this.fbRefHeatupFactor.on('value', function(fbData) {
  	this.heatupFactor = fbData.val();
  	this.planNextTarget();
  }, this);

  this.fbRefSchedule.on('value', function(fbData) {
  	this.schedule = fbData.val();
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

	if (self.mode === 'auto') {

		this.findScheduleItem(this.schedule, 'next',function(e, objNextItem) {
			if (e) {
				log.warn(e);
				return;
			}
			timeTillNextTarget = objNextItem.time;
			target = self.schedule[objNextItem.key].target;
			self.nextScheduledTarget = target;
			
			/** Consider heatupTime */
			if (self.hasPreheat) {
				heatupTime = calcHeatupTime(self.temperature, self.heatupFactor, target);
			 	timeTillNextTarget = timeTillNextTarget - heatupTime;
			}

			/** AutoAway activated **/
			if (self.isAutoAway) {
				/** Room is unoccupied */
				if(self.eta >= 5) { 
					/** TimeTillNextTarget is greater than ETA */
					var timeTillTargetSwitch = timeTillNextTarget - self.eta -1 ;
					if(timeTillNextTarget > self.eta) {
						aaTarget = calcAutoAwayTarget(self.eta, self.temperature, self.currentScheduledTarget);
					}
					else {
						aaTarget = calcAutoAwayTarget(self.eta, this.temperature, this.nextScheduledTarget);
					}
					self.setTarget(aaTarget, ' autoaway ');
				}
				
			}
			/** Room is occupied */
			else {
				log.info({home: self.homeId, room: self.roomId}, ' Heating: timeTillNextTarget: '+(timeTillNextTarget).toFixed(0)+' minutes for target: '+target);
				/** schedule next target */
				clearTimeout(self.nextTargetTimer);
				self.nextTargetTimer = setTimeout(function() { 
							log.info({home: self.homeId, room: self.roomId}, ' Timer is executed with target: '+target + ' in ' + Math.max(0,timeTillNextTarget*60*1000));
			 				self.currentScheduledTarget = target;
			 				self.setTarget(target,'schedule timeout');
			 				self.setVirtualTarget(target, 'schedule timeout');
			 			}, Math.max(0,timeTillNextTarget*60*1000));

			 	// (function(self) {
			 	// 	clearTimeout(self.nextTargetTimer);
			 	// 	self.nextTargetTimer = setTimeout(
			 	// 		function(target) {
			 	// 			log.info({home: self.homeId, room: self.roomId}, ' Timer is executed with target: '+target+ ' in ' + Math.max(0,timeTillNextTarget));
			 	// 			self.currentScheduledTarget = target;
			 	// 			self.setTarget.bind(self);
			 	// 		},Math.max(0,timeTillNextTarget),target);
			 	// })(self);

			}
	
		});

	}
  	
};

Heating.prototype.setTarget = function(target, reason) {

	if (target !== null) {
		this.realTarget = target;
		
		this.fbRef.child('realTarget').set(target);
		log.info({home: this.homeId, room: this.roomId}, ' Heating:  Set new realTarget ' +target+ ' by ' + reason);
	}	

};


Heating.prototype.setVirtualTarget = function(target, reason) {
	if (target !== null) {
		this.fbRef.child('virtualTarget').set(target);
		log.info({home: this.homeId, room: this.roomId}, ' Heating:  Set new virtualTarget ' +target+ ' by ' + reason);
	}
};



Heating.prototype.setStatus = function() {

	var status = null;

	if (this.mode === 'auto') {
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
			if(this.hasPreheat){
				if (this.realTarget > this.virtualTarget) {
					status = 'preheating';
				}
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
	log.info({home: this.homeId, room: this.roomId}, ' Heating: Status: ' + this.status);
	this.fbRef.child('status').set(status);

};


/**
*  React to a ManualChange Event
*/
Heating.prototype.reactToManualChange = function(target) {
  	this.setTarget(target, ' manual change at thermostat ');
  	this.setVirtualTarget(target, ' manual change at thermostat ');
    log.info({home: this.homeId, room: this.roomId}, ' Heating:  Manual Change accepted ' + target);
};

/**
 * Calculate time it takes to heat up to nextTarget
 */
function calcHeatupTime(temperature,heatupFactor, nextTarget) {
	
	var heatupTime = temperature + heatupFactor * ( nextTarget - temperature );
	if (heatupTime > HEATUPLIMIT) {
		return HEATUPLIMIT;
	}
	else {
		return heatupTime;
	} 
}

/**
 * Finds last or next (as specified by which) schedule item.
 * Callback functions has to be in the form function(error, {key, time})
 * where key directs to the correponding scheduleEvent
 * and time is the time in ms from now until that event (only for next)
 */
Heating.prototype.findScheduleItem = function(schedule, which, cb) {
  if (!_.isEmpty(schedule)) {
	  var maxMinutesDiff = 0;
	  var minMinutesDiff = 99999999999;

	  var key = null;

	  for (var scheduleEventKey in schedule) {
	  	//(function(i) {

	  	var item = schedule[scheduleEventKey];

		var totalMinutesUntilNow = ((moment().tz("Europe/Zurich").isoWeekday()-1)*24*60)+(moment().tz("Europe/Zurich").hours()*60)+moment().tz("Europe/Zurich").minutes();
	//	console.log('totalMinNow: ' + totalMinutesUntilNow );
		var totalMinutesOfItem = ((item.weekday-1)*24*60)+(item.hour*60)+item.minute;
	//	console.log('totalMinItem: ' + totalMinutesOfItem );

		var totalMinutesDiff =  mod((totalMinutesOfItem - totalMinutesUntilNow),(24*7*60));

	//	console.log('Total Diff in Minutes: ' + totalMinutesDiff );
		var dayDiffs = Math.floor(totalMinutesDiff / 60 / 24);
	//	console.log('Diff in days: ' + dayDiffs);
		var hourDiffs = Math.floor(totalMinutesDiff / 60 % 24);
	//	console.log('Diff in hours: ' + hourDiffs);
		var minDiffs = Math.floor(totalMinutesDiff % 60);
	//	console.log('Diff in minutes: ' + minDiffs);

		if (which === 'previous') {
			if (totalMinutesDiff >= maxMinutesDiff) {
				maxMinutesDiff = totalMinutesDiff;
				key = scheduleEventKey;
			}
		}
		else if (which === 'next') {
			if (totalMinutesDiff <= minMinutesDiff) {
				minMinutesDiff = totalMinutesDiff;
				key = scheduleEventKey;
			}
		}
		else {
			log.warn({home: this.homeId, room: this.roomId}, ' Heating:  Invalid Function Call Parameter: ' + which);
		}

	  }

	   if (which === 'previous') {
	   		//log.info({home: this.homeId, room: this.roomId}, ' Heating: Previous Schedule event is in '+ maxMinutesDiff +' min --> ' + JSON.stringify(schedule[key]));
	   		cb(null, { key: key, time: maxMinutesDiff });
	   }
	   else if (which === 'next') {
	   	  // log.info({home: this.homeId, room: this.roomId}, ' Heating: Next Schedule event is in '+ minMinutesDiff +' min --> ' + JSON.stringify(schedule[key]));
	   	    cb(null, { key: key, time: minMinutesDiff });
	   }

  }
  //cb(new Error('Schedule is empty'), null);  
};

function calcAutoAwayTarget(eta, temperature, scheduledTarget) {
// TODO - Calculate auto away target based on scheduled Target	
	var target = null;
	return target;

}

function milliSecToDate(text, time) {
	var tmins = (time/1000/60).toFixed(0);
	var hours = Math.floor(tmins/60);
	var mins = tmins % 60;
	console.log(text+' Time: '+hours +' h '+mins +' mins');
}

// Javascript does not a valid modulo opertion for negative numbers, so we fix that here
function mod(m, n) {
    return ((m%n)+n)%n;
}

Heating.prototype.setFbRefOff = function() {
	this.fbRef.off();
	this.fbRefMode.off();
	this.fbRefIsAutoAway.off();
	this.fbRefTemperature.off();
	this.fbRefEta.off();
	this.fbRefVirtualTarget.off();
	this.fbRefHeatupFactor.off();
	this.fbRefSchedule.off();
	log.debug({home: this.homeId, room: this.roomId}, ' Heating: All fbRefs are set to off');
};


module.exports = Heating;