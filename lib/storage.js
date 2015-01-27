/**
 * Storage
 * Manages connection to PostgreSQL Database
 */

/*jslint node: true */
'use strict';

//var Firebase = require('firebase');
var bunyan = require('bunyan');
var bunyanLogentries = require('bunyan-logentries');

var log = bunyan.createLogger({
    name: "backend",
    streams: [{
        stream: process.stdout,
        level: "info"
    }, {
        level: 'info',
        stream: bunyanLogentries.createStream({
            token: 'e103b6d1-907f-4cc7-83b4-8908ef866522'
        }),
        type: 'raw'
    }]
});

process.env.TZ = 'Europe/Amsterdam';


/** Require configuration file */
var config = require('../config.json');
//var fbBaseUrl = config.firebase;

// var moment = require('moment-timezone');
// moment().tz("Europe/Zurich").format();


var pg = require('pg');

var sql = require('sql');

// Table definitions
var tables = {
	measurements : sql.define({
	  name: 'measurements',
	  columns: ['id', 'homeid', 'roomid', 'date','timestamp','value','type']
	}),

	thermostats: sql.define({
	  name: 'thermostats',
	  columns: ['id', 'homeid', 'roomid', 'trvid', 'date', 'timestamp', 'value', 'type']
	}),

	roomStates: sql.define({
	  name: 'roomStates',
	  columns: ['id', 'homeid', 'roomid', 'date', 'timestamp', 'value', 'type']
	}),

	rooms: sql.define({
		name: 'rooms',
		columns: ['id', 'homeid', 'roomid', 'category']
	})
};	


function performQuery(query,cb) {

	pg.connect(process.env.DATABASE_URL, function(err, client, done) {
		
		if(err) {
			done();
			log.info(' Storage: ERROR fetching client from pool' + err);
    		cb(err,null);
  		}
  		else {
			client.query(query, function(err, result) {
				done();
				if (err) {
					log.info(' Storage: ERROR executing query: '+JSON.stringify(query)+' err: ' +err);
					cb(err,null);
				}
				else {
					cb(null,result);
				}
			});

		}			
  		
  	});	  		
}

module.exports = {
	/**
	 * Save to database
	 * @param  {object}   obj obj needs propertz table and property data
	 * @param  {Function} cb  Callback function with err and response
	 */
	save: function(obj,cb) {

		cb = cb || function(err,res) {};
		var timestamp = Date.now();
		var date = new Date();

		if (!obj.hasOwnProperty('table')) {
			cb('No table provided', null);
		}

		if (!obj.hasOwnProperty('data')) {
			cb('No data provided', null);
		}

		var data = obj.data;

		if (!data.hasOwnProperty('value') || data.value === null) {
			cb('No value provided', null);
		}

		if (!data.hasOwnProperty('type') || data.type === null) {
			cb('No type provided', null);
		}

		if (!data.hasOwnProperty('timestamp')) {
			data.timestamp = timestamp;
		}

		if (!data.hasOwnProperty('date')) {
			data.date = date;
		}

		var query = tables[obj.table]
			.insert(data)
			.toQuery();

		performQuery(query,cb);	
	}
};

