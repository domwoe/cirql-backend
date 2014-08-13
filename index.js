'use strict'

var Firebase = require('firebase');
var bunyan = require('bunyan');

var log = bunyan.createLogger({name: 'cirql-backend'});

var Home = require('./lib/home.js');

var helper = require('./lib/helperFuncs.js');

/** Require configuration file */
var config = require('./config.json');
var fbBaseUrl = config.firebase;

var fbRef = new Firebase(fbBaseUrl);

var homes = [];

fbRef.child('homes').once('value', function(fbHomes) {
  fbHomes.forEach(function(fbHome) {
    var id = fbHome.name();
    log.info('create home with id: '+id);
    homes.push({id: id, obj: new Home(id)});
  });
});

/**
/* Listen if new home is added infirebase
/* and create new home object
*/
fbRef.child('homes').on('child_added', function(fbHome) {
  var id = fbHome.name();
  log.info('created home with id: '+id);
  homes.push({id: id, obj: new Home(id)});
});


/** Listen if home is deleted and deletes home obj */
fbRef.child('homes').on('child_removed', function(fbHome) {
  var id = fbHome.name();
  var index = helper.indexOfById(homes,id);

  if (index > -1) {
    log.info('deleted home with id: '+id);
    delete homes[index].obj;
    homes.splice(index,1);
  }

});
