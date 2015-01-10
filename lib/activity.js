/**
 * Activity controller class
 *
 */

/*jslint node: true */
'use strict';

var Firebase = require('firebase');
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

var helper = require('./helperFuncs.js');

/** Require configuration file */
var config = require('../config.json');
var fbBaseUrl = config.firebase;

var moment = require('moment-timezone');
moment().tz("Europe/Zurich").format();


function Activity(homeId, roomId) {
    this.homeId = homeId;
    this.roomId = roomId;

    log.info({
        home: this.homeId,
        room: this.roomId
    }, ' Activity: Initialized ');
    this.fbRefRaw = new Firebase(fbBaseUrl + 'homes/' + this.homeId + '/activity/' + this.roomId+'/raw');
    this.fbRefLogDe = new Firebase(fbBaseUrl + 'homes/' + this.homeId + '/activity/' + this.roomId+'/de');
    this.fbRefLogEn = new Firebase(fbBaseUrl + 'homes/' + this.homeId + '/activity/' + this.roomId+'/en');

}




module.exports = Activity;
