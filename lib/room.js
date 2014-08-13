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
                var temperature = 0
                for (var k in self.thermostats) {
                  temperature += parseFloat(self.thermostats[k].temperature);
                }
                return temperature/Object.keys(self.thermostats).length;
              })(self.thermostats);
              fbRef.child('temperature').set(self.temperature.toFixed(1));
            }, self);
        });
      }
    }
  }, this);


  /**
  /* Listen if new room is added to home in firebase
  /* and create new room object
  */
  fbRef.child('rooms').on('child_added', function(fbRoom) {
    var roomId = fbRoom.name();
    log.info('created room with id: '+roomId);
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

Room.prototype.myFunc = function() {

};


module.exports = Room;
