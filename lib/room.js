/**
 * Room class
 *
 */

'use strict'

var Firebase = require('firebase');
var bunyan = require('bunyan');

var log = bunyan.createLogger({name: 'cirql-backend'});

var Netatmo = require('./netatmo.js');
var Heating = require('./heating.js');

var helper = require('./helperFuncs.js');

/** Require configuration file */
var config = require('../config.json');
var fbBaseUrl = config.firebase;

function Room(homeId, roomId) {
  this.id = roomId;
  this.thermostats = {};
  this.sensors = [];
  this.temperature = null;

  var fbRef = new Firebase(fbBaseUrl+'homes/'+homeId+'/rooms/'+this.id);

  /** Create heating controller if room has thermostats */
  fbRef.once('value', function(fbRoom) {
    var self = this;
    if (fbRoom.hasChild('thermostats')) {
      var heating = new Heating();
      var fbThermostats = fbRoom.child('thermostats');
      if (fbRoom.child('hasNetatmo').val()) {
        // TODO: Set this.temperature = Netatmo temperature;
      }
      else {
        fbThermostats.forEach(function(fbThermostat) {
          var thermostatId = fbThermostat.name();
          self.thermostats[thermostatId] = {temperature: 0};
          var fbThermostatRef = new Firebase(fbBaseUrl+'homes/'+homeId+'/thermostats');
          fbThermostatRef.child(thermostatId)
            .child('temperature')
            .on('value', function(fbThermostatTemp) {
              self.thermostats[thermostatId].temperature = fbThermostatTemp.val();
              self.temperature = (function avgThermostatTemperature(thermostats) {
                var temperature = 0;
                for (var k in self.thermostats) {
                  temperature += parseFloat(self.thermostats[k].temperature);
                }
                return (temperature/Object.keys(self.thermostats).length).toFixed(1);
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
