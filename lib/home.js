/**
 * Home class
 *
 */

/*jslint node: true */
'use strict';

var Firebase = require('firebase');
var bunyan = require('bunyan');

var log = bunyan.createLogger({name: 'cirql-backend'});

var Room = require('./room.js');

var helper = require('./helperFuncs.js');

/** Require configuration file */
var config = require('../config.json');
var fbBaseUrl = config.firebase;

function Home(id) {
  this.id = id;
  this.rooms = {};

  this.fbRef = new Firebase(fbBaseUrl+'homes/'+id);

  /**
  /* Listen if new room is added to home in firebase
  /* and create new room object
  */
  this.fbRef.child('rooms').on('child_added', function(fbRoom) {
    var roomId = fbRoom.name();
    log.info({home: this.id}, ' Home: new Room with id: '+roomId);
    var roomObject = new Room(id,roomId); 
    this.rooms[roomId] = roomObject;
  }, this);


  /** Listen if room is deleted and deletes room obj */
  this.fbRef.child('rooms').on('child_removed', function(fbRoom) {
    log.info({home: this.id}, ' Home: child_removed event for rooms');
    var id = fbRoom.name();
    var roomObj = this.rooms[id];

    if (roomObj) {
      log.info({home: this.id}, ' Home: delete Room with id: '+id);
      roomObj.setFbRefOff();
      delete this.rooms[id];
    }


  }, this);

}




Home.prototype.myFunc = function() {

};


module.exports = Home;
