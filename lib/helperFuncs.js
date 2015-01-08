/**
/* Returns index of array where id key of object == id
/* @param {array} array - array of objects with id keys
/* @param {string or number} id - id of which index will be returned
/* @return {number} index of array where array[index].id = id or -1 otherwise
 */
var indexOfById = function(array, id) {
    for (var i = 0; i < array.length; i++) {
        if (array[i].hasOwnProperty('id')) {
            if (array[i].id == id) {
                return i;
            } else if (i == array.length - 1) {
                return -1;
            }
        } else throw new Error('Array element has no property called id');
    }
};


var createEvent = function(type, msg) {
    var date = new Date();
    var timestamp = date.toString();
    var eventData = {
        'date': timestamp,
        'type': type,
        'msg': msg
    };
    return eventData;
};

module.exports.indexOfById = indexOfById;
module.exports.createEvent = createEvent;

