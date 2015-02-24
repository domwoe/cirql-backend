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

    if ((this.sessionId === null || !this.isSessionValid()) && resource !== '/sessions') {

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

                self.wait = false;
                self.handleQueue();

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
        resource = '/sessions/' + this.sessionId + resource;
    }
    options.url = nefit.apiUrl + resource;
    options.json = true;
    options.body = data;
    var self = this;
    request.post(options, function(err, res, body) {

        if (self.connecting === false) {

            self.wait = false;
            self.handleQueue();

        }

        //console.log('res: ' + JSON.stringify(res));
        if (err) {

            cb.call(self, err, null);

        } else {

            if (res.statusCode === 200) {
                cb.call(self, null, body);
            } else {
                cb.call(self, res.statusCode, body);
            }
        }

    });

}

function put(resource, data, cb) {

    if (this.sessionId === null || !this.isSessionValid()) {

        if (!this.connecting) {

            log.info({
                home: this.homeId,
            }, 'NEFIT: : Not connected');

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
            resource = '/sessions/' + this.sessionId + resource;
        }

        options.url = nefit.apiUrl + resource;
        options.json = true;
        options.body = data;

        // log.info({
        //     home: this.homeId,
        // }, "NEFIT: " + JSON.stringify(options));

        var self = this;
        request.put(options, function(err, res, body) {

            //console.log('Res: ' + JSON.stringify(res));

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


                self.wait = false;
                self.handleQueue();

                cb(err, {
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

    this.wait = false;

    this.requestQueue = [];

    // Get credentials from firebase
    // 

    if (!uuid) {
        this.fbRef.child('uuid').once('value', function(uuidSnap) {
            if (uuidSnap.val()) {
                this.uuid = uuidSnap.val();
                console.log('UUID: ' + this.uuid);
            }
        }, this);
    }

    if (!userPw) {
        this.fbRef.child('userPw').once('value', function(userPwSnap) {
            if (userPwSnap.val()) {
                this.userPw = userPwSnap.val();
                console.log('userPw: ' + this.userPw);
            }
        }, this);
    }

    if (!devicePw) {
        this.fbRef.child('devicePw').once('value', function(devicePwSnap) {
            if (devicePwSnap.val()) {
                this.devicePw = devicePwSnap.val();
                console.log('devicePw: ' + this.devicePw);
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

    this.fbRef.child('initiateTest').on('value', function(fbTest) {

        this.fbRef.child('test').set('initiated...');

        if (fbTest.val() === true) {
            var self = this;
            this.getOutdoorTemp(function(err, res) {
                if (err) {

                    self.fbRef.child('test').set('Failed with response '+ JSON.stringify(err));
                }
                else {

                    self.fbRef.child('test').set('Successful with response '+ res);
                    var time = new Date();
                    var that = self;
                    setTimeout(function() {
                         that.fbRef.child('test').set('Last successful test '+ time);
                    },60*1000);
                }
            });
        }
    }, this);

}

Nefit.prototype.connect = function(cb) {

    this.connecting = true;


    log.info({
        home: this.homeId,
    }, "NEFIT: Connecting...");



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
                console.log('SUCCESS');
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

            // console.log('STATUS CODE:' + err);
            // console.log('BODY: ' + res);


            this.connecting = false;
            log.warn({
                home: this.homeId,
            }, 'NEFIT: Connect failed with err: ' + err + ' and message ' + res);
            cb(success);

        }

        console.log('-------------------');

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
        if (!err) {

                var res = result.res;
                var body = result.body;

                if (res.statusCode === 200) {

                    if (body.hasOwnProperty('value')) {

                        cb(null, body.value);

                    }
                    // body has no property called value
                    else {

                        log.warn({
                            home: self.homeId,
                        }, "NEFIT: getRoomTemp body has no property called value: " + JSON.stringify(body));

                        cb(res, null);
                    }

                }
                // statusCode !== 200
                else {

                    log.warn({
                        home: self.homeId,
                    }, "NEFIT: getRoomTemp statusCode: " + res.statusCode);

                    cb(res, null);

                }


            }
            // err
            else {
                log.warn({
                    home: self.homeId,
                }, "NEFIT: Error in method getTrvAddress");

                cb(err, null);
            }
    });


    
};

Nefit.prototype.getSessionId = function() {

    return this.sessionId;
};

Nefit.prototype.startGetter = function() {


};

Nefit.prototype.setTrvAddress = function(trvAddress, radiatorId, cb) {

    log.info({
        home: this.homeId,
    }, "NEFIT: setTrvAddress of " + radiatorId + " with " + trvAddress);

    var ressource = '/heatingCircuits/hc1/radiator/' + radiatorId + '/physAddr';

    var data = {
        value: trvAddress
    };

    var fn = function() {
        put.call(this, ressource, data, function(err, res) {

            log.info({
                home: '',
            }, 'NEFIT' + JSON.stringify(err));


            log.info({
                home: '',
            }, 'NEFIT' + JSON.stringify(res));

            if (!err) {

                if (res.res.statusCode === 204) { // setting successful

                    cb(null, true);
                } else {
                    cb(res.res.statusCode, res.body);
                }

            } else { // err

                cb(err, null);

            }
        });
    };
    if (this.wait === true) { // Push request on queue
        log.info({
            home: this.homeId,
        }, "NEFIT: Push request on queue");
        this.requestQueue.push(fn);
    } else { // Exectute request now
        this.wait = true;
        log.info({
            home: this.homeId,
        }, "NEFIT: Execute request now");
        fn.call(this);
    }

};


Nefit.prototype.getTrvAddress = function(radiatorId, cb) {

    console.log('-------------------');
    console.log('GET TRV ADDRESS');
    console.log('radiator: ' + radiatorId);


    var resource = '/heatingCircuits/hc1/radiator/' + radiatorId + '/physAddr';

    var self = this;

    var fn = function() {
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
    if (this.wait === true) { // Push request on queue
        console.log('Push request on queue');

        this.requestQueue.push(fn);
    } else { // Exectute request now
        this.wait = true;
        console.log('Execute request now');

        fn.call(this);
    }

    console.log('-------------------');

};

Nefit.prototype.getTarget = function(radiatorId, cb) {

    var resource = '/heatingCircuits/hc1/radiator/' + radiatorId + '/radiatorSP';

    var self = this;

    var fn = function() {

        get.call(this, resource, function(err, result) {

            if (!err) {

                var res = result.res;
                var body = result.body;

                if (res.statusCode === 200) {

                    if (body.hasOwnProperty('value')) {

                        cb(null, body.value);

                    }
                    // body has no property called value
                    else {

                        log.warn({
                            home: self.homeId,
                        }, "NEFIT: getTarget body has no property called value: " + JSON.stringify(body));

                        cb('No body', null);
                    }

                }
                // statusCode !== 200
                else {

                    log.warn({
                        home: self.homeId,
                    }, "NEFIT: getTarget statusCode: " + res.statusCode);

                    cb(res.statusCode, body);

                }


            }
            // err
            else {
                log.warn({
                    home: self.homeId,
                }, "NEFIT: Error in method getTarget");

                cb(err, null);
            }

        });
    };
    if (this.wait === true) { // Push request on queue
        this.requestQueue.push(fn);
    } else { // Exectute request now
        this.wait = true;
        fn.call(this);
    }


};



Nefit.prototype.setTarget = function(radiatorId, target, cb) {


    log.info({
        home: this.homeId,
    }, "NEFIT: setTarget " + target + " at " + radiatorId);



    var floatTarget = parseFloat(target);
    var resource = '/heatingCircuits/hc1/radiator/' + radiatorId + '/radiatorSP';

    var data = {
        value: floatTarget
    };

    var fn = function() {

        put.call(this, resource, data, function(err, res) {

            if (!err) {

                if (res.res.statusCode === 204) { // setting successful

                    cb(null, true);
                } else {
                    cb(res.res.statusCode, res.body);
                }

            } else { // err

                cb(err, null);

            }
        });

    };
    if (this.wait === true) { // Push request on queue
        this.requestQueue.push(fn);
    } else { // Exectute request now
        this.wait = true;
        fn.call(this);
    }



};

Nefit.prototype.isSessionValid = function() {

    var now = Date.now();

    if (this.date && now - this.date < 300 * 1000) {
        return true;
    } else {
        return false;
    }
};

Nefit.prototype.handleQueue = function() {

    console.log('-------------------');
    console.log('HANDLE QUEUE');


    if (this.requestQueue.length > 0) {
        this.requestQueue[0].call(this);
        this.requestQueue.shift();
        console.log('Execute queued function');
    } else {
        console.log('Nothing in queue');
    }
    console.log('-------------------');
};


module.exports = Nefit;