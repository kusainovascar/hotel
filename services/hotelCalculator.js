'use strict';
const store = require('../data/store');
const policy = require('../assistant-policy');
function calculateHotelTrip(params) {
  return policy.calculate(params, store.getPricing());
}
module.exports = { calculateHotelTrip };
