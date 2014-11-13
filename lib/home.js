/**
 * Home class
 *
 */

/*jslint node: true */
'use strict';

var Firebase = require('firebase');
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

var Room = require('./room.js');

var NetatmoAPI = require('./netatmoapi.js');

/** Require configuration file */
var config = require('../config.json');
var fbBaseUrl = config.firebase;

var fbBaseRef = new Firebase(fbBaseUrl);

function Home(id) {
  this.id = id;
  this.rooms = {};

  this.fbRef = new Firebase(fbBaseUrl+'homes/'+id);

  /**
  /* Listen for netatmo
  /* and create new netatmoapi object
  */
  this.fbRef.child('sensors').on('child_added', function(sensor) {
    if (sensor.name() === 'netatmo') {
      log.info({home: this.id}, 'Netatmo added');
      this.netatmo = new NetatmoAPI(this.id);
      var self = this;
      setTimeout(function() { 
        self.netatmo.getDevices();
      },2000);
    }
  }, this);

  /** Listen if netatmo is deleted and deletes netatmoapi obj */
  this.fbRef.child('sensors').on('child_removed', function(sensor) {
    log.info({home: this.id}, ' Home: child_removed event for sensors');
    if (sensor.name() === 'netatmo' && this.hasOwnProperty('netatmo')) {
      log.info({home: this.id}, ' Home: delete Netatmo');
      this.netatmo.setFbRefOff();
      delete this.netatmo;
    }


  }, this);

  /**
  /* Listen if new room is added to home in firebase
  /* and create new room object
  */
  this.fbRef.child('rooms').on('child_added', function(fbRoom) {
    var roomId = fbRoom.name();
    log.info({home: this.id}, ' Home: new Room with id: '+roomId);
    var roomObject = new Room(id,roomId);
    var self = this;
    (function listenForNetatmo() {
      roomObject.on('netatmoModuleAdded', function(data) {
        if (self.hasOwnProperty('netatmo')) {
          self.netatmo.start({
            stationId: data.stationId,
            moduleId: data.moduleId,
            type: 'temperature,humidity,co2'
          });
        }
        else {
          self.interval = setInterval(function() {
            if (self.hasOwnProperty('netatmo')) {
              clearInterval(self.interval)
              delete self.interval;
              self.netatmo.start({
                stationId: data.stationId,
                moduleId: data.moduleId,
                type: 'temperature,humidity,co2'
              });
            }  
          },2000);
        }      
      });
      roomObject.on('netatmoModuleDeleted', function(data) {
        self.netatmo.stop(data.moduleId);
      });
    }());

    /**
     * Check if thresholds are available and add 
     * threshold templates if not
     */
    if (!fbRoom.hasChild('thresholds')) {
      var category = fbRoom.child('category').val();
      if (category) {
        fbBaseRef
          .child('templates')
          .child(category)
          .child('thresholds')
          .once('value', function(fbThresholds) {
            fbRoom.ref().child('thresholds').set(fbThresholds.val());
        });
      }
    } 
    
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
