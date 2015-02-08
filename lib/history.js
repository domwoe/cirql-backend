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
    var interval = 24 * 60 * 60 * 1000;

    var deleteOldEntries = function() {

        // console.log('--------------------------------');
        // console.log('History: Looking for old entried');
        // console.log('--------------------------------');

        var threshold = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
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

History.prototype.save = function(type, value, timestamp) {

    if (type && value) {

        // console.log('--------------------------------');
        // console.log('History: Add item');
        // console.log('--------------------------------');

        this.fbRef.child(type).push({
            timestamp: timestamp || Date.now(),
            value: value
        });
    }

};

History.prototype.setFbRefOff = function() {
    this.fbRef.off();
    clearInterval(this.interval);
};

module.exports = History;