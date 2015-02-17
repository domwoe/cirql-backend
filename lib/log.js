/**
 * Log class
 *
 */

/*jslint node: true */
'use strict';

var Firebase = require('firebase');
var config = require('../config.json');
var fbBaseUrl = config.firebase;
var storage = require('./storage.js');

function Log(homeId) {
	// console.log('--------------------------------');
 //    console.log('Log started');
 //    console.log('--------------------------------');
    this.homeId = homeId;
    this.fbRef = new Firebase(fbBaseUrl + 'homes/' + this.homeId + '/log');

    this.fbRef.on('child_added', function(fbEvent) {

        if (fbEvent.val() !== null) {
            var event = fbEvent.val();

            // console.log('--------------------------------');
            // console.log('Log new event: ' + JSON.stringify(event));
            // console.log('--------------------------------');

            if (event.type === 'view') {

                delete event.type;

                storage.save({
                    table: 'views',
                    data: event
                }, function(err, res) {
                    if (!err) {
                        fbEvent.ref().remove();
                    }
                    // console.log('--------------------------------');
                    // console.log('Log ERROR: ' + err);
                    // console.log('--------------------------------');
                });

            }
        }

    });

}

Log.prototype.setFbRefOff = function() {
    this.fbRef.off();
};

module.exports = Log;