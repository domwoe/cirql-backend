/**
 * Room class
 *
 */

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
  //this.sensors = [];
  this.netatmo = {};
  this.temperature = null;

  var fbRef = new Firebase(fbBaseUrl+'homes/'+this.homeId+'/rooms/'+this.id);

  /** Create heating controller if room has thermostats */
  fbRef.once('value', function(fbRoom) {
    var self = this;
    /** If Netatmo use Netatmo temperature as room temperature */
    if (fbRoom.child('hasNetatmo').val()) {
      fbRef.child('sensors').child('netatmo').once('value', function(fbNetatmo) {
        self.netatmo.stationId = fbNetatmo.child('station').val();
        self.netatmo.moduleId = fbNetatmo.child('module').val();
        self.netatmo.obj = new Netatmo(self.netatmo.stationId, self.netatmo.moduleId);
        var fbNetatmoRef = new Firebase(fbBaseUrl+'homes/'+self.homeId+'/sensors/' +
        'netatmo/stations/'+self.netatmo.stationId+'/modules/'+self.netatmo.moduleId);
        fbNetatmoRef.child('temperature').on('value', function(fbTemperature) {
          self.temperature = fbTemperature.val();
          self.netatmo.temperature = self.temperature;
          fbRef.child('temperature').set(self.temperature);
        }, self);
      }, self);
      if (fbRoom.hasChild('thermostats')) {
        var heating = new Heating(self.homeId, self.id);
      }
    }
    else {
      /** If no Netatmo take avg thermostat temp as room temp */
      if (fbRoom.hasChild('thermostats')) {
        var heating = new Heating(self.homeId, self.id);
        var fbThermostats = fbRoom.child('thermostats');
        fbThermostats.forEach(function(fbThermostat) {
          var thermostatId = fbThermostat.name();
          self.thermostats[thermostatId] = {temperature: 0};
          var fbThermostatRef = new Firebase(fbBaseUrl+'homes/'+self.homeId+'/thermostats');
          fbThermostatRef.child(thermostatId)
            .child('temperature')
            .on('value', function(fbThermostatTemp) {
              self.thermostats[thermostatId].temperature = fbThermostatTemp.val();
              self.temperature = (function avgThermostatTemperature(thermostats) {
                var temperature = 0;
                for (var k in thermostats) {
                  temperature += parseFloat(thermostats[k].temperature);
                }
                return (temperature/Object.keys(thermostats).length).toFixed(1);
              })(self.thermostats);
              fbRef.child('temperature').set(self.temperature);
            }, self);
        });
      }
    }
  }, this);



}

Room.prototype.myFunc = function() {

};


module.exports = Room;
