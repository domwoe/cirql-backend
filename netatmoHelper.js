/*jslint node: true */
'use strict';

var Firebase = require('firebase');
var pg = require('pg');

var Netatmo = require('./lib/netatmoapi2.js');

var config = require('./config.json');
var fbBaseUrl = config.firebase;

var fbRef = new Firebase(fbBaseUrl);
fbRef.auth('b1CGRaicJ8bItqzasSevA3KMlXw7nwMW06v4dz1e', function(error, result) {
    if (error) {

    } else {


    }
});

function toMeasurementValueString(json, homeid, roomid, type) {


    if (Object.keys(json).length > 0) {

        var key = Object.keys(json)[0];
        var timestamp = key * 1000;
        var date = new Date(timestamp);
        var value = json[Object.keys(json)[0]];

        delete json[key];

        return toMeasurementValueString(json, homeid, roomid, type) + ",('" + homeid + "','" + roomid + "','" + date + "'," + timestamp + "," + value + ",'" + type + "')";

    } else {


        return '';
    }

}


var TYPE = 'temperature';


function performQuery(query, cb) {

    pg.connect(process.env.DATABASE_URL || 'postgres://u7k0k5gci86dnn:pbar5t97n1p0p0c916ci6upj0p4@ec2-54-204-32-25.compute-1.amazonaws.com:5992/d35611vsbhilc3?ssl=true', function(err, client, done) {
        if (err) {
            done();
            console.log(' Storage: ERROR fetching client from pool' + err);
            cb(err, null);
        } else {
            client.query(query, function(err, result) {
                done();
                if (err) {
                    console.log(' Storage: ERROR executing query: ' + JSON.stringify(query) + ' err: ' + err);
                    cb(err, null);
                } else {
                    cb(null, result);
                }
            });

        }

    });
}

function getLastTimestamp(roomid, type, cb) {

    var query = "SELECT timestamp " +
        "FROM measurements " +
        "WHERE type = '" + type + "' " +
        "AND roomid = '" + roomid + "' " +
        "ORDER BY timestamp DESC " +
        "LIMIT 1;";
    performQuery(query, function(err, result) {

        if (!err) {

            if (result !== null) {

                if (result.rows) {

                    var lastTimestamp = (new Date(2015, 1, 1)).getTime();

                    if (result.rows[0] && result.rows[0].timestamp) {
                        lastTimestamp = result.rows[0].timestamp;
                    }
                    cb(lastTimestamp);

                }
                // result has no property rows
                else {

                    console.log('Result has no property rows');
                }


            }
            //result == null
            else {

                console.log('DB response is empty');

            }


        }
        // ERROR
        else {

            console.log(err);

        }
    });
}


function getNetatmoData(valueString, netatmo, homeid, roomid, stationid, moduleid, lastTimestamp, cb) {

    var options = {
        stationId: stationid,
        moduleId: moduleid,
        last: lastTimestamp / 1000,
        type: TYPE
    };

    netatmo.getData(options, function(err, jsonData) {

        if (!err) {

            var latestNetatmoTimestamp = Object.keys(jsonData).sort().reverse()[0] * 1000;

            console.log('Got dataset with length: ' + Object.keys(jsonData).length);

            //console.log('timestamp: '+lastTimestamp);
            //console.log(' netatmo timestamp: '+latestNetatmoTimestamp);

            if (lastTimestamp !== latestNetatmoTimestamp) {
                valueString = valueString + toMeasurementValueString(jsonData, homeid, roomid, 'netatmo_' + TYPE);
                getNetatmoData(valueString, netatmo, homeid, roomid, stationid, moduleid, latestNetatmoTimestamp, cb);
            } else {

                cb(valueString.slice(1));
            }


        }
        // ERROR
        else {

            console.log(err);

        }
    });
}

function insertIntoDB(valueString) {

    var query = "INSERT INTO measurements " +
        "(homeid, roomid, date, timestamp, value, type) " +
        "VALUES " + valueString + ";";

    performQuery(query, function(err, result) {

        if (err) {
            console.log(err);
        } else {
            console.log('Successfully stored in DB');
        }
    });
}

// var homeid = 'simplelogin:114';
// var netatmo = new Netatmo(homeid);
// var roomid = '-Jgpt5N1siD309fDaWWW';
// var stationid = '70:ee:50:04:6f:30';
// var moduleid = '02:00:00:04:df:9c';
// var type = 'netatmo_' + TYPE;


fbRef.child('homes').on('child_added', function(fbHome) {

    var homeid = fbHome.key();

    if (homeid === 'simplelogin:143') {

    fbHome
        .child('sensors')
        .child('netatmo')
        .child('stations')
        .forEach(function(fbStation) {

            var stationid = fbStation.key();

            var netatmo = new Netatmo(homeid);

            fbStation
                .child('modules')
                .forEach(function(fbModule) {

                    var moduleid = fbModule.key();

                    var roomid = fbModule.child('room').val();

                    if (roomid && roomid !== 'null') {

                        var type = 'netatmo_' + TYPE;
                        getLastTimestamp(roomid, type, function(lastTimestamp) {

                            var valueString = '';

                            getNetatmoData(valueString, netatmo, homeid, roomid, stationid, moduleid, lastTimestamp, function(valueString) {

                                //console.log(valueString);
                                if (valueString !== '') {
                                    insertIntoDB(valueString);
                                } else {
                                    console.log('No new Netatmo data');
                                }

                            });
                        });


                    }


                });
        });

}




});