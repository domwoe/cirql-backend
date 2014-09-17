/**
 * Room class
 *
 */

/*jslint node: true */
'use strict';

var Firebase = require('firebase');
var bunyan = require('bunyan');

var log = bunyan.createLogger({name: 'cirql-backend'});

var Netatmo = require('./netatmo.js');
var Heating = require('./heating.js');

/** Require configuration file */
var config = require('../config.json');
var fbBaseUrl = config.firebase;

function Room(homeId, roomId) {
  this.id = roomId;
  this.homeId = homeId;
  this.thermostats = {};
  this.netatmo = null;
  this.temperature = null;
  this.heating = null;

  log.info({home: this.homeId, room: this.id}, ' Room: Initialized ');
  this.fbRef = new Firebase(fbBaseUrl+'homes/'+this.homeId+'/rooms/'+this.id);

  /** Create And Delete heating controller iff room has thermostats */
  this.fbRef.child('thermostats').on('value', function(fbThermostats) {
      if(fbThermostats.hasChildren()) {
        if(this.heating === null) {
          this.heating = new Heating(this.homeId, this.id);
          log.info({home: this.homeId, room: this.id}, ' Room: new Heating');
        }
      }
      else {
        if(this.heating !== null) {
          log.info({home: this.homeId, room: this.id}, ' Room: delete Heating');
           this.heating.setFbRefOff();
           this.heating = null;
        }
      }
    }, 
    this
    );

  /** Create and Delete Netatmo iff room has a netatmo sensor */
  this.fbRef.child('sensors').child('netatmo').on('value', function(fbNetatmo){
    if(fbNetatmo.hasChild('station') && fbNetatmo.hasChild('module')) {
      if(this.netatmo === null){
          this.netatmo = new Netatmo(this.homeId, this.id, this);
          log.info({home: this.homeId, room: this.id}, ' Room: new Netatmo');
      }
      else {
        this.netatmo.setFbRefOff();
        this.netatmo = null;
        log.info({home: this.homeId, room: this.id}, ' Room: delete Netatmo');
        this.netatmo = new Netatmo(this.homeId, this.id, this);
        log.info({home: this.homeId, room: this.id}, ' Room: new Netatmo');
      }
    }
    else {
      if(this.netatmo !== null){
        console.log('netatmo: ' + JSON.stringify(this.netatmo));
        this.netatmo.setFbRefOff();
        this.netatmo = null;
        log.info({home: this.homeId, room: this.id}, ' Room: delete Netatmo');
      }
    }
  },this);

  //   if (this.fbRef.child('hasNetatmo').val()) {
  //     log.info({home: this.homeId, room: this.id}, ' Room: Has an netatmo station ');

  //     fbRef.child('sensors').child('netatmo').once('value', function(fbNetatmo) {
  //       self.netatmo.stationId = fbNetatmo.child('station').val();
  //       self.netatmo.moduleId = fbNetatmo.child('module').val();
  //       self.netatmo.obj = new Netatmo(self.netatmo.stationId, self.netatmo.moduleId);
  //       var fbNetatmoRef = new Firebase(fbBaseUrl+'homes/'+self.homeId+'/sensors/' +
  //       'netatmo/stations/'+self.netatmo.stationId+'/modules/'+self.netatmo.moduleId);
  //       fbNetatmoRef.child('temperature').on('value', function(fbTemperature) {
  //         self.temperature = fbTemperature.val();
  //         self.netatmo.temperature = self.temperature;
  //         fbRef.child('temperature').set(self.temperature);
  //       }, self);
  //     }, self);
  //     if (fbRoom.hasChild('thermostats')) {
  //       heating = new Heating(self.homeId, self.id);
  //     }
  //   }
  //   else {
  //     log.info({home: this.homeId, room: this.id}, ' room has no netatmo station ');
  //     * If no Netatmo take avg thermostat temp as room temp 
  //     if (fbRoom.hasChild('thermostats')) {
  //       heating = new Heating(self.homeId, self.id);
  //       var fbThermostats = fbRoom.child('thermostats');
  //       fbThermostats.forEach(function(fbThermostat) {
  //         var thermostatId = fbThermostat.name();
  //         self.thermostats[thermostatId] = {temperature: 0};
  //         var fbThermostatRef = new Firebase(fbBaseUrl+'homes/'+self.homeId+'/thermostats');
  //         fbThermostatRef.child(thermostatId)
  //           .child('temperature')
  //           .on('value', function(fbThermostatTemp) {
  //             self.thermostats[thermostatId].temperature = fbThermostatTemp.val();
  //             self.temperature = (function avgThermostatTemperature(thermostats) {
  //               var temperature = 0;
  //               for (var k in thermostats) {
  //                 temperature += parseFloat(thermostats[k].temperature);
  //               }
  //               return (temperature/Object.keys(thermostats).length).toFixed(1);
  //             })(self.thermostats);
  //             fbRef.child('temperature').set(self.temperature);
  //           }, self);
  //       });
  //     }
  //   }
  // }, this);
}

function setRoomTemperature = function() {
    if(this.fbRef.child('useNetatmo').val()) {
      this.fbRef.child('temperature').set(this.netatmoTemperature);
    }
    else {
      this.fbRef.child('temperature').set(this.thermostatTemperature);
    }
}

Room.prototype.setNetatmoTemperature = function(netatmoTemperature) {
    this.netatmoTemperature = netatmoTemperature;
    setRoomTemperature(netatmoTemperature);
    log.info({home: this.homeId, room: this.id}, ' Room: new netatmo temperature value: '+ this.temperature);
  }

Room.prototype.setFbRefOff = function() {
  this.fbRef.off();
  log.info({home: this.homeId, room: this.id}, ' Room: All fbRefs are set to off');
};


module.exports = Room;
