/**
 * Netatmo class
 *
 */

/*jslint node: true */
'use strict';

var Firebase = require('firebase');
var bunyan = require('bunyan');

var request = require('requestretry')

var log = bunyan.createLogger({name: 'cirql-backend'});

/** Require configuration file */
var config = require('../config.json');
var fbBaseUrl = config.firebase;
var netatmo = config.netatmo;

function refreshAccessToken(refreshToken,callback) {
	var params = {
		method: 'POST',
		url: netatmo.reqTokenUrl,
		form: {
			grant_type: 'refresh_token',
			refresh_token: refreshToken,
			client_id: netatmo.clientId,
			client_secret: netatmo.clientSecret
		},
		maxAttempts: 10,
		retryDelay: 5000
	};
	request(params, function (error, response, body) {
        if (!error && response.statusCode == 200) {
            var jsonObj = JSON.parse(body);
            callback(null,jsonObj);
        }
        else {
            callback(error,null);
        }
    });
}

function NetatmoAPI(homeId) {
  this.homeId = homeId;
  this.fbRefNetatmo =  new Firebase(fbBaseUrl+'homes/'+this.homeId+'/sensors/netatmo/');
  log.info({home: this.homeId},'Netatmo FirebaseRef: '+this.fbRefNetatmo);
  this.accessToken = null;
  this.modules = {};

  // Init refresh token and get access token
  this.fbRefNetatmo.child('refreshToken').once('value',function(refreshTokenSnap) {
  	var refreshToken = refreshTokenSnap.val();
  	console.log(refreshToken);
  	this.refreshToken = refreshToken;

  	var self = this;
  	refreshAccessToken(refreshToken,function(err,res) {
  		if (!err && res && res.hasOwnProperty('access_token')) {
  			self.accessToken = res.access_token;
  			self.expires = Date.now() + res.expires_in*1000;
  			self.refreshToken = res.refresh_token;
  			refreshTokenSnap.ref().set(res.refresh_token);
  		}
  		else {
  			log.warn({home: this.homeId},'NetatmoAPI refreshAccessToken error : '+err);
  		}
  		
  	});

  },this);

}

NetatmoAPI.prototype.getDevices = function() {
	function getList() {
		var self = this;
		var params = {
			method: 'GET',
			url: netatmo.apiUrl+'/devicelist?access_token='+self.accessToken,
			maxAttempts: 3,
			retryDelay: 5000
		};
		request(params, function (error, response, body) {
	        if (!error && response.statusCode == 200) {
	            var jsonObj = JSON.parse(body);
		  		var devices = jsonObj.body.devices;
		  		devices.forEach(function(device) {
		  			if (device.hasOwnProperty('station_name')) {
		  				self.fbRefNetatmo.child('stations').child(device._id).child('name').set(device.station_name);
		  				self.fbRefNetatmo.child('stations').child(device._id).child('modules').child(device._id).child('type').set('station');
		  				self.fbRefNetatmo.child('stations').child(device._id).child('modules').child(device._id).child('name').set(device.module_name);
		  			}
		  		})
		  		var modules = jsonObj.body.modules;
			  	modules.forEach(function(module) {
			  		if (module.type == 'NAModule1') {
			  			var type = 'outside'
			  		}
			  		else if (module.type == 'NAModule4') {
			  			var type = 'room'
			  		}
			  		else {
			  			return log.warn({home: this.homeId},'NetatmoAPI Unknown module type : '+module.type);
			  		}
			  		self.fbRefNetatmo.child('stations').child(module.main_device).child('modules').child(module._id).child('name').set(module.module_name);
			  		self.fbRefNetatmo.child('stations').child(module.main_device).child('modules').child(module._id).child('type').set(type);
			  	});
	        }
	        else {
	           log.warn({home: this.homeId},'NetatmoAPI getDevices error : '+err);
	        }
   	 	});
	}
	if (typeof this.expires === 'undefined' || this.expires < Date.now()-5000) {
		var self = this;
		refreshAccessToken(self.refreshToken,function(err,res) {
	  		if (!err && res && res.hasOwnProperty('access_token')) {
	  			self.accessToken = res.access_token;
	  			self.expires = Date.now() + res.expires_in*1000;
	  			self.refreshToken = res.refresh_token;
	  			self.fbRefNetatmo.child('refreshToken').set(res.refresh_token);

	  			getList.apply(self);
	  		}
	  		else {
	  			log.warn({home: this.homeId},'NetatmoAPI refreshAccessToken error : '+err);
	  		} 
  		});
	}
	else {
  		getList.apply(this);
  	}	
};

NetatmoAPI.prototype.getData = function(opt) {
	var stationId = opt.stationId;
	var moduleId = opt.moduleId || stationId;
	var last = opt.last || 'last';
	var type = opt.type;

	if (last !== 'last') {
		var which = '&date_begin'+last;
	}
	else {
		var which = '&date_end=last';
	}


	function task(stationId,moduleId,type,which) {
		var self = this;
		var params = {
			method: 'GET',
			url: netatmo.apiUrl+'/getmeasure'+
				'?access_token='+self.accessToken+
				'&device_id='+stationId+
				'&module_id='+moduleId+
				'&scale=max'+
				'&optimize=false'+
				'&type='+type+
				which,
			maxAttempts: 3,
			retryDelay: 5000
		};
		var typeString = type
		request(params, function (error, response, body) {
	        if (!error) {
	            var jsonObj = JSON.parse(body);
	            if (jsonObj.status === 'ok') {
	            	log.info({home: this.homeId},'NetatmoAPI new Data for module : '+moduleId);
	            	var measurements = jsonObj.body;
	            	var lastTimestamp = Object.keys(measurements).sort().reverse()[0];
					var lastMeasurement = measurements[lastTimestamp];
					var type = typeString.split(',');
					for (var i = 0; i < type.length; i++) {
						self.fbRefNetatmo.child('stations').child(stationId).child('modules').child(moduleId).child(type[i]).set(lastMeasurement[i]);
					}
					var date = new Date(parseInt(lastTimestamp)*1000);
					self.fbRefNetatmo.child('stations').child(stationId).child('modules').child(moduleId).child('timestamp').set(lastTimestamp);
					self.fbRefNetatmo.child('stations').child(stationId).child('modules').child(moduleId).child('date').set(date+'');
	            }
	            else {
	            	log.warn({home: this.homeId},'NetatmoAPI getMeasure response status : '+jsonObj.status);
	            }
	        }    
	        else {
	        	log.warn({home: this.homeId},'NetatmoAPI getMeasure error : '+error);
	        }	    
		  
		});	        
	}
	if (typeof this.expires === 'undefined' || this.expires < Date.now()-5000) {
		var self = this;
		refreshAccessToken(self.refreshToken,function(err,res) {
	  		if (!err && res && res.hasOwnProperty('access_token')) {
	  			self.accessToken = res.access_token;
	  			self.expires = Date.now() + res.expires_in*1000;
	  			self.refreshToken = res.refresh_token;
	  			self.fbRefNetatmo.child('refreshToken').set(res.refresh_token);

	  			task.call(self,stationId,moduleId,type,which);
	  		}
	  		else {
	  			log.warn({home: this.homeId},'NetatmoAPI refreshAccessToken error : '+err);
	  		} 
  		});
	}
	else {
  		task.call(this,stationId,moduleId,type,which);
  	}	
}

NetatmoAPI.prototype.start = function(opt) {
	log.info({home: this.homeId},'NetatmoAPI: Start data downloader for module: '+opt.moduleId);
	var self = this;
	self.getData(opt);
	var interval = setInterval(function() {
		self.getData(opt);
	},5*60*1000);
	self.modules['moduleId'] = interval;
}

NetatmoAPI.prototype.stop = function(moduleId) {
	log.info({home: this.homeId},'NetatmoAPI: Stop data downloader for module: '+moduleId);
	clearInterval(this.modules['moduleId']);
	delete this.modules['moduleId'];
}

NetatmoAPI.prototype.setFbRefOff = function() {
	//this.fbRefNetatmo.child('temperature').off();
};

module.exports = NetatmoAPI;