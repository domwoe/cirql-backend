'use strict';

// CONFIG
// ------------------------------

var DEBUG = true;

var HOST = 'http://api.wunderground.com/api/';
var API_KEY = 'dba6dfab4a377a7d';
var FORMAT = '.json';

var LOCATION_COUNTRY = 'Switzerland';
var LOCATION_CITY = 'Zurich';
var RESOURCE = 'history_';

var RATE_COUNT = 10;
var RATE_TIME = 'minute';


var async = require('async');
var pg = require('pg');
var request = require('request');
var RateLimiter = require('limiter').RateLimiter;
var limiter = new RateLimiter(RATE_COUNT, RATE_TIME);

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

function getLastDate(cb) {

    var query = "SELECT timestamp " +
        "FROM weather " +
        "WHERE location = '" + LOCATION_CITY + "' " +
        "ORDER BY timestamp DESC " +
        "LIMIT 1;";
    performQuery(query, function(err, result) {

        if (!err) {

            if (result !== null) {

                if (result.rows) {

                    var lastTimestamp = (new Date(2015, 1, 1));

                    if (result.rows[0] && result.rows[0].timestamp) {
                        lastTimestamp = result.rows[0].timestamp;
                    }
                    cb(new Date(lastTimestamp));

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

function get(path, cb) {
    var url = HOST + API_KEY + path;

    if (DEBUG) {
        console.log('Request URL: ' + url);
    }
    limiter.removeTokens(1, function(err, remainingRequests) {
        // err will only be set if we request more than the maximum number of
        // requests we set in the constructor

        // remainingRequests tells us how many additional requests could be sent
        // right this moment

        request(url, function(error, response, body) {
            if (!error && response.statusCode == 200) {
                if (DEBUG) {
                    console.log('response body: ' + body);
                }
                try {
                    body = JSON.parse(body);
                    cb(error, body);
                } catch (err) {
                    cb('Invalid JSON response', body);
                }
            } else if (error) {
                console.log('error: ' + err);
            }

        });
    });
}

function toWeatherValueString(array) {


    if (array.length > 0) {

        var year = parseInt(array[0].utcdate.year);
        var month = parseInt(array[0].utcdate.mon) - 1;
        var day = parseInt(array[0].utcdate.mday);
        var hour = parseInt(array[0].utcdate.hour);
        var min = parseInt(array[0].utcdate.min);

        var date = new Date(year, month, day, hour, min);
        var timestamp = date.getTime();

        var temperature = array[0].tempm;
        var dewpoint = array[0].dewptm;
        var humidity = array[0].hum;
        var pressure = array[0].pressurem;
        var windchill = array[0].windchillm;
        var windspeed = array[0].wspdm;
        var winddir = array[0].wdird;
        var rain = array[0].rain;
        var snow = array[0].snow;


        array.shift();

        return toWeatherValueString(array) +
            ",('" + location + "','" + timestamp + "','" + temperature + "'," +
            dewpoint + "," + humidity + ",'" + windspeed +
            winddir + "','" + windchill + "','" + pressure + "','" + rain + "','" + snow + "')";

    } else {


        return '';
    }

}

function insertIntoDB(valueString) {

    var query = "INSERT INTO weather " +
        "(location, timestamp, temperature, dewpoint, humidity, windspeed, winddir, windchill, pressure, rain, snow) " +
        "VALUES " + valueString + ";";

    performQuery(query, function(err, result) {

        if (err) {
            console.log(err);
        } else {
            console.log('Successfully stored in DB');
        }
    });
}

Date.prototype.addDays = function(days) {
    var dat = new Date(this.valueOf());
    dat.setDate(dat.getDate() + days);
    return dat;
};

getLastDate(function(err, initialDate) {

    if (!err) {

        var now = new Date();

        var date = initialDate;

        var data = [];

        async.whilst(
            function() {
                return date < now;
            },
            function(callback) {
                date.addDays(1);

                var day = (date.getDate()).toString();
                var month = (date.getMonth() + 1).toString();
                var year = (date.getFullYear()).toString();

                if (day.length == 1) {

                    day = '0' + day;

                }

                if (month.length == 1) {

                    month = '0' + month;

                }

                var dateString = year + month + day;

                var path = '/' + RESOURCE + dateString + '/q/' + LOCATION_COUNTRY + '/' + LOCATION_CITY + FORMAT;

                get(path, function(err, json) {

                    if (!err) {

                        if (json.observations) {

                            data = data.concat(json.observations);

                        } else {
                            console.log('Object has no property observations');
                        }
                    }
                    // ERROR
                    else {

                        console.log(err);
                    }
                });
            },
            function(err) {

                console.log(toWeatherValueString(data).slice(1));
                //InsertToDB(toWeatherValueString(array));
            }
        );

    }
    // ERROR
    else {
        console.log(err);
    }
});