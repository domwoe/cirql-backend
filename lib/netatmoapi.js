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
  			log.warn({home: self.homeId},err);
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
			maxAttempts: 1,
			retryDelay: 5000
		};
		request(params, function (error, response, body) {
	        if (!error && response.statusCode == 200) {
	            var jsonObj = JSON.parse(body);
		  		var devices = jsonObj.body.devices;
		  		devices.forEach(function(device) {
		  			if (device.hasOwnProperty('station_name')) {
		  				self.fbRefNetatmo.child(device._id).child('name').set(device.station_name);
		  				self.fbRefNetatmo.child(device._id).child('modules').child(device._id).child('type').set('station');
		  				self.fbRefNetatmo.child(device._id).child('modules').child(device._id).child('name').set(device.module_name);
		  				self.fbRefNetatmo.child(device._id).child('last_status').set(device.last_status_store);
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
			  			return console.log ('Unknown module type: '+module.type);
			  		}
			  		self.fbRefNetatmo.child(module.main_device).child('modules').child(module._id).child('name').set(module.module_name);
			  		self.fbRefNetatmo.child(module.main_device).child('modules').child(module._id).child('type').set(type);
			  		self.fbRefNetatmo.child(module.main_device).child('modules').child(module._id).child('last_seen').set(module.last_seen);
			  		//new Module(module.main_device);
			  		//new Module(module.main_device,module._id);
			  	});
	        }
	        else {
	           console.log(error);
	        }
   	 	});
	}
	if (this.expires < Date.now()-5000) {
		var self = this;
		refreshAccessToken(refreshToken,function(err,res) {
	  		if (!err && res && res.hasOwnProperty(access_token)) {
	  			self.accessToken = res.access_token;
	  			self.expires = Date.now() + res.expires_in*1000;
	  			self.refreshToken = res.refresh_token;
	  			self.fbRefNetatmo.child('refreshToken').set(res.refresh_token);

	  			getList.apply(self);
	  		}
	  		else {
	  			log.warn({home: this.homeId},err);
	  		} 
  		});
	}
	else {
  		getList.apply(this);
  	}	
	
};

NetatmoAPI.prototype.setFbRefOff = function() {
	//this.fbRefNetatmo.child('temperature').off();
};

module.exports = NetatmoAPI;