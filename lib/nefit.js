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
    streams: [{
        stream: process.stdout,
        level: "info"
    }, {
        level: 'info',
        stream: bunyanLogentries.createStream({
            token: 'e103b6d1-907f-4cc7-83b4-8908ef866522'
        }),
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
    rejectUnhauthorized: false,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_10_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/39.0.2171.71 Safari/537.36',
        'Authorization': 'Basic ' + nefit.authToken,
        'Accept-Encoding': 'application/json',
        'Content-Type': 'application/json'
    }
};



function get(resource, cb) {

    if ( ( this.sessionId === null || !this.isSessionValid() ) && resource !== '/sessions') {

        if (!this.connecting) {

            var self = this;
            this.connect(function(success) {
                if (success) {

                    get.call(self, resource, cb);

                }
            });


        }
        // self.connecting === true
        else {

            log.info({
                home: this.homeId,
            }, "NEFIT: Already connecting");

            if (this.retries < 3) {
                var self = this;
                setTimeout(function() {
                    get.call(self, resource, cb);
                    self.retries++;
                }, 3000);
            }    

        }

    }
    // has sessionId 
    else {
        if (resource !== '/sessions' && this.sessionId !== null) {
            resource = '/sessions/' + this.sessionId + resource;
        }
        options.url = nefit.apiUrl + resource;
        var self = this;
        request(options, function(err, res, body) {
            
          //console.log('Res: ' + JSON.stringify(res));
        

            if (!err && res.statusCode === 404) {

                if (!self.connecting) {

                    self.connect(function(success) {
                        if (success) {
                            self.retries = 0;
                            get.call(self, resource, cb);

                        }
                    });


                }
                // self.connecting === true
                else {

                    log.info({
                        home: self.homeId,
                    }, "NEFIT: Already connecting");

                }



            } else {

                cb(err, {
                    res: res,
                    body: body
                });

            }

        });
    }
}

function post(resource, data, cb) {

    if (resource !== '/sessions') {
        resource = '/sessions/' + this.sessionId  + resource;
    }
    options.url = nefit.apiUrl + resource;
    options.json = true;
    options.body = data;
    var self = this;
    request.post(options, function(err, res, body) {
       
        //console.log('res: ' + JSON.stringify(res));
       
        if (!err && res.statusCode === 200) {
            cb.call(self, null, body);
        }
    });

}

function put(resource, data, cb) {

    if (this.sessionId === null || !this.isSessionValid() ) {

        if (!this.connecting) {

            //console.log('this: ' + util.inspect(this));

            var self = this;
            this.connect(function(success) {
                if (success) {

                    put.call(self, resource, data, cb);

                }
            });


        }
        // self.connecting === true
        else {

            log.info({
                home: this.homeId,
            }, "NEFIT: Already connecting");

            var self = this;
            setTimeout(function() {
                put.call(self, resource, data, cb);
            }, 3000);

        }

    }
    // has sessionId 
    else {
        if (resource !== '/sessions') {
          resource = '/sessions/' + this.sessionId  + resource;
        }

        options.url = nefit.apiUrl + resource;
        options.json = true;
        options.body = data;

        log.info({
                        home: this.homeId,
                    }, "NEFIT: "+JSON.stringify(options));

        var self = this;
        request.put(options, function(err, res, body) {
            
            console.log('Res: ' + JSON.stringify(res));
          
            if (!err && res.statusCode === 404) {

                if (!self.connecting) {

                   
                    self.connect(function(success) {
                        if (success) {

                            put.call(self, resource, data, cb);

                        }
                    });


                }
                // self.connecting === true
                else {

                    log.info({
                        home: self.homeId,
                    }, "NEFIT: Already connecting");

                }



            } else {

                self.waiting = false;

                cb({
                    res: res,
                    body: body
                });

            }

        });
    }
}

function Nefit(homeId, uuid, userPw, devicePw) {
    this.homeId = homeId;
    this.fbRef = new Firebase(fbBaseUrl + 'homes/' + this.homeId + '/nefit');

    this.uuid = uuid;
    this.userPw = userPw;
    this.devicePw = devicePw;
    this.sessionId = null;

    this.connecting = false;

    this.waiting = false;

    // this.uuid = '308011323';
    // this.userPw = '1234';
    // this.devicePw = 'gWLBtpkvE4dZ3PjT';


    // Get credentials from firebase
    // 
    
    if (!uuid) {
        this.fbRef.child('uuid').once('value', function(uuidSnap) {
            if (uuidSnap.val()) {
              this.uuid = uuidSnap.val();
            }  
        }, this);
    }

    if (!userPw) {
        this.fbRef.child('userPw').once('value', function(userPwSnap) {
          if (userPwSnap.val()) {
            this.userPw = userPwSnap.val();
          }
        }, this);
    }

    if (!devicePw) {
        this.fbRef.child('devicePw').once('value', function(devicePwSnap) {
          if (devicePwSnap.val()) {
            this.devicePw = devicePwSnap.val();
          }
        }, this);
    }

    this.fbRef.child('session').on('value', function(sessionSnap) {
      if (sessionSnap.child('sessionId').val()) {
        this.sessionId = sessionSnap.child('sessionId').val();
      }
      if (sessionSnap.child('sessionId').val()) {
        this.date = sessionSnap.child('date').val();
      }

    }, this);

}

Nefit.prototype.connect = function(cb) {

    this.connecting = true;


    var data = {
        deviceType: 'RRC',
        uuid: this.uuid,
        userPw: this.userPw,
        devicePw: this.devicePw
    };

    post.call(this, '/sessions', data, function(err, res) {

        var success = false;

        if (!err) {

            if (res.hasOwnProperty('sessionId')) {
                this.connecting = false;
                success = true;
                this.sessionId = res.sessionId;
                this.fbRef.child('session').child('sessionId').set(res.sessionId);
                this.fbRef.child('session').child('date').set(Date.now());
                cb(success);
            }
            // response has no sessionId
            else {
                this.connecting = false;
                log.warn({
                    home: this.homeId,
                }, "NEFIT: Connect failed because response has no sessionId: " + JSON.stringify(res));
                cb(success);
            }


        }
        // err
        else {

            this.connecting = false;
            log.warn({
                home: this.homeId,
            }, "NEFIT: Connect failed with err: " + err);
            cb(success);

        }

    });
};


Nefit.prototype.getSessions = function(cb) {

    get('/sessions', function(err, res) {
        cb(err, res);
    });
};

Nefit.prototype.getOutdoorTemp = function(cb) {

    get('/system/sensors/temperatures/outdoor_t1', function(err, res) {
        cb(err, res);
    });
};

Nefit.prototype.getRoomTemp = function(cb) {

    get('/heatingCircuits/hc1/roomtemperature', function(err, res) {
        cb(err, res);
    });
};

Nefit.prototype.getSessionId = function() {

    return this.sessionId;
};

Nefit.prototype.startGetter = function() {


};

Nefit.prototype.setTrvAddress = function(trvAddress, radiatorId, cb) {

    var ressource = '/heatingCircuits/hc1/radiator/' + radiatorId + '/physAddr';

    var data = {
        value: trvAddress
    };

    put.call(this, ressource, data, cb);

};


Nefit.prototype.getTrvAddress = function(radiatorId, cb) {

    var resource = '/heatingCircuits/hc1/radiator/' + radiatorId + '/physAddr';

    var self = this;

    get.call(this, resource, function(err, result) {

        if (!err) {

            var res = result.res;
            var body = result.body;

            if (res.statusCode === 200) {

                if (body.hasOwnProperty('value')) {

                    cb(body.value);

                }
                // body has no property called value
                else {
                    log.warn({
                        home: self.homeId,
                    }, "NEFIT: getTrvAddress body has no property called value: " + JSON.stringify(body));
                }

            }
            // statusCode !== 200
            else {

                log.warn({
                    home: self.homeId,
                }, "NEFIT: getTrvAddress statusCode: " + res.statusCode);

            }


        }
        // err
        else {
            log.warn({
                home: self.homeId,
            }, "NEFIT: Error in method getTrvAddress");
        }

    });

};

Nefit.prototype.getTarget = function(radiatorId, cb) {

    var resource = '/heatingCircuits/hc1/radiator/' + radiatorId + '/radiatorSP';

    var self = this;

    get.call(this, resource, function(err, result) {

        if (!err) {

            var res = result.res;
            var body = result.body;

            if (res.statusCode === 200) {

                if (body.hasOwnProperty('value')) {

                    cb(body.value);

                }
                // body has no property called value
                else {
                    log.warn({
                        home: self.homeId,
                    }, "NEFIT: getTarget body has no property called value: " + JSON.stringify(body));
                }

            }
            // statusCode !== 200
            else {

                log.warn({
                    home: self.homeId,
                }, "NEFIT: getTarget statusCode: " + res.statusCode);

            }


        }
        // err
        else {
            log.warn({
                home: self.homeId,
            }, "NEFIT: Error in method getTarget");
        }

    });

};



Nefit.prototype.setTarget = function(radiatorId, target, cb) {



    var floatTarget = parseFloat(target);
    var resource = '/heatingCircuits/hc1/radiator/' + radiatorId + '/radiatorSP';

    var data = {
        value: floatTarget
    };

    put.call(this, resource, data, cb);

    var timer = 0;

    if (this.waiting) {
        timer = 3000; 
    }
    // var self = this;
    // setTimeout(function() {
    //     this.waiting = true;
    //     put.call(self, resource, data, cb);
    // },timer);    

};

Nefit.prototype.isSessionValid = function() {

  var now = Date.now();

  if ( this.date && now - this.date < 300 * 1000 ) {
    return true;
  }
  else {
    return false;
  }
};


module.exports = Nefit;