/**
 * Nefit class
 *
 */

/*jslint node: true */
'use strict';

var Firebase = require('firebase');

var request = require('request');

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

/** Require configuration file */
var config = require('../config.json');
var fbBaseUrl = config.firebase;
var nefit = config.nefit;


var options = {
    proxy: process.env.QUOTAGUARDSTATIC_URL || 'http://quotaguard1965:6c16b0ba8231@us-east-1-static-brooks.quotaguard.com:9293',
    strictSSL: false, // allow us to use our self-signed cert for testing
    rejectUnhauthorized : false,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_10_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/39.0.2171.71 Safari/537.36',
        'Authorization':    'Basic '+nefit.authToken,
        'Accept-Encoding':  'application/json',
        'Content-Type':     'application/json'
    }
};
 
function get(resource, cb) {
  options.url = nefit.apiUrl+resource;
  request(options, function(err, res, body) {
    console.log('Error: '+err);
    console.log('Res: '+JSON.stringify(res));
    console.log('body: '+JSON.stringify(body));
    if (!err && res.statusCode === 200) {
      cb(null,body);
    }
  });
}

function post(resource, data, cb) {
  options.url = nefit.apiUrl+resource;
  options.json = true;  
  options.body = data;
  var self = this;
  request.post(options, function(err, res, body) {
    console.log('Options: '+JSON.stringify(options));
    console.log('Error: '+err);
    console.log('res: '+JSON.stringify(res));
    console.log('body '+JSON.stringify(body));
    if (!err && res.statusCode === 200) {
      cb.call(self,null,body);
    }
  });
}

function put(resource, data, cb) {
  options.url = nefit.apiUrl+resource;
  options.form = data;
  request.put(options, function(err, res, body) {
    console.log('Error: '+err);
    console.log('res: '+res);
    console.log('body '+body);
  });
}

function Nefit(homeId, uuid, userPw, devicePw) {
  this.homeId = homeId;
  this.fbRef =  new Firebase(fbBaseUrl+'homes/'+this.homeId+'/nefit/');
  this.uuid = '305010521';
  this.userPw = '1234';
  this.devicePw = 'YF4Wbe3vAQTrVDQZ';
  this.sessionId = null;

  // if (!uuid) {
  //   this.fbRef.child('uuid').once('value', function(uuidSnap) {
  //     this.uuid = uuidSnap.val();
  //   },this);
  // }  

  // if (!userPw) {
  //   this.fbRef.child('userPw').once('value', function(userPwSnap) {
  //     this.userPw = userPwSnap.val();
  //   },this);
  // }

  // if (!devicePw) {
  //   this.fbRef.child('devicePw').once('value', function(devicePwSnap) {
  //     this.devicePw = devicePwSnap.val();
  //   },this);
  // }

}

Nefit.prototype.connect = function() {

  var data = {
    deviceType:   'RRC',
    uuid:         this.uuid,
    userPw:       this.userPw,
    devicePw:     this.devicePw
  };

  post.call(this,'/sessions',data, function(err,res) {
    if (res.hasOwnProperty('sessionId')) {
      console.log(res.sessionId);
      this.sessionId = res.sessionId;
    }
  });
};


Nefit.prototype.getSessions = function(cb) {

  get('/sessions', function(err,res) {
    cb(err,res);
  });
};

Nefit.prototype.getOutdoorTemp = function(cb) {

  get('/sessions/'+this.sessionId+'/system/sensors/temperatures/outdoor_t1', function(err,res) {
    cb(err,res);
  });
};

Nefit.prototype.getRoomTemp = function(cb) {

  get('/sessions/'+this.sessionId+'/heatingCircuits/hc1/roomtemperature', function(err,res) {
    cb(err,res);
  });
};

Nefit.prototype.getSessionId = function() {

  return this.sessionId;
};

Nefit.prototype.startGetter = function() {

 
};


module.exports = Nefit;


