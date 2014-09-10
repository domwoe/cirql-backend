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
  this.rooms = [];

  this.fbRef = new Firebase(fbBaseUrl+'homes/'+id);

  /**
  /* Listen if new room is added to home in firebase
  /* and create new room object
  */
  this.fbRef.child('rooms').on('child_added', function(fbRoom) {
    var roomId = fbRoom.name();
    log.info({home: this.id}, ' Home: new Room with id: '+roomId);
    this.rooms.push({id: roomId, obj: new Room(id,roomId)});
  }, this);


  /** Listen if room is deleted and deletes room obj */
  this.fbRef.child('rooms').on('child_removed', function(fbRoom) {
    log.info({home: this.id}, ' Home: child_removed event for rooms');
    var id = fbRoom.name();
    var index = helper.indexOfById(this.rooms,id);

    if (index > -1) {
      log.info({home: this.id}, ' Home: delete Room with id: '+id);
      this.rooms[index].obj.setFbRefOff();
      delete this.rooms[index].obj;
      this.rooms.splice(index,1);
    }


  }, this);

}




Home.prototype.myFunc = function() {

};


module.exports = Home;
