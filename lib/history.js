/**
 * History class
 *
 */

/*jslint node: true */
'use strict';

var Firebase = require('firebase');
var config = require('../config.json');
var fbBaseUrl = config.firebase;

function History(homeId, roomId) {
    // console.log('--------------------------------');
    // console.log('History started');
    // console.log('--------------------------------');
    this.homeId = homeId;
    this.roomId = roomId;
    this.fbRef = new Firebase(fbBaseUrl + 'homes/' + this.homeId + '/histories/' + this.roomId);
    this.interval = null;


    // Every day
    var interval = ( 1 + Math.random() ) * 12 * 60 * 60 * 1000;

    var deleteOldEntries = function() {

        // console.log('--------------------------------');
        // console.log('History: Looking for old entried');
        // console.log('--------------------------------');



        var today = new Date();
        today.setHours(0);
        today.setMinutes(0);
        today.setSeconds(0);
        var otherDay = new Date(today);
        otherDay.setDate(today.getDate() - 2);

        var threshold = otherDay.getTime();



        this.fbRef.once('value', function(fbHistories) {

            fbHistories.forEach(function(fbHistory) {

                fbHistory.forEach(function(fbItem) {

                    if (fbItem.val()) {

                        var item = fbItem.val();

                        if (item.timestamp && item.timestamp < threshold) {

                            fbItem.ref().remove();
                            // console.log('--------------------------------');
                            // console.log('History: Old item deleted');
                            // console.log('--------------------------------');

                        }
                    }

                });
            });


        }, this);
    };
    deleteOldEntries.bind(this);
    var self = this;
    this.interval = setInterval(function() {
        deleteOldEntries.call(self);
    }, interval);

}

function roundToMinute(timestamp) {

    return Math.round(timestamp / 1000 / 60) * 60 * 1000;
}

History.prototype.save = function(type, value, timestamp) {

    if (type && value !== null && value !== 'undefined') {
        
        var tempTimestamp = timestamp || Date.now();
        var roundedTimestamp = roundToMinute(tempTimestamp);


        console.log('--------------------------------');
        console.log('History: Add item');
        console.log('type: '+type);
        console.log('value: '+value);
        console.log('timestamp: '+tempTimestamp);
        console.log('roundedTimestamp: '+roundedTimestamp);
        console.log('--------------------------------');

        this.fbRef.child(type).push({
            timestamp: roundedTimestamp,
            value: value
        });
    }

};

History.prototype.setFbRefOff = function() {
    this.fbRef.off();
    clearInterval(this.interval);
};

module.exports = History;