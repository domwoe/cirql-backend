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


var Home = require('./lib/home.js');

var helper = require('./lib/helperFuncs.js');

/** Require configuration file */
var config = require('./config.json');
var fbBaseUrl = config.firebase;

var fbRef = new Firebase(fbBaseUrl);

fbRef.child('aSystemStart').set(true);
var systemBootupTimer = setTimeout(function() {
    log.info('System has booted');
    fbRef.child('aSystemStart').set(false);
}, 45000);

var homes = [];

/**
/* Listen if a new home is added infirebase
/* and create new home objec
*/
fbRef.child('homes').on('child_added', function(fbHome) {
    var id = fbHome.name();
    log.info({
        home: id
    }, 'created home with id: ' + id);
    homes.push({
        id: id,
        obj: new Home(id)
    });
});


/** Listen if home is deleted and deletes home obj */
fbRef.child('homes').on('child_removed', function(fbHome) {
    var id = fbHome.name();
    var index = helper.indexOfById(homes, id);

    if (index > -1) {
        log.info({
            home: id
        }, 'deleted home with id: ' + id);
        delete homes[index].obj;
        homes.splice(index, 1);
    }

});
