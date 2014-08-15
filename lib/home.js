/**
 * Home class
 *
 */

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

  var fbRef = new Firebase(fbBaseUrl+'homes/'+id);

  /**
  /* Listen if new room is added to home in firebase
  /* and create new room object
  */
  fbRef.child('rooms').on('child_added', function(fbRoom) {
    var roomId = fbRoom.name();
    log.info('homeId: '+this.id+', created room with id: '+roomId);
    this.rooms.push({id: roomId, obj: new Room(id,roomId)});
  }, this);


  /** Listen if room is deleted and deletes room obj */
  fbRef.child('rooms').on('child_removed', function(fbRoom) {
    log.info('child_removed event for rooms of home id:'+this.id);
    var id = fbRoom.name();
    var index = helper.indexOfById(this.rooms,id);

    if (index > -1) {
      log.info('deleted room with id: '+id);
      delete this.rooms[index].obj;
      this.rooms.splice(index,1);
    }

  }, this);

}




Home.prototype.myFunc = function() {

};


module.exports = Home;
