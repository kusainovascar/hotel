'use strict';

const CONFIG = {
  roomRate: 30000,
  minGroup: 2,
  maxGroup: 300,
  meals: {
    none:      { label: 'Без питания',     rate: 0 },
    breakfast: { label: 'Завтрак',         rate: 4000 },
    half:      { label: 'Завтрак и ужин',  rate: 10000 },
    full:      { label: 'Полный пансион',  rate: 15000 }
  }
};

function dayNumber(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return NaN;
  const ms = Date.parse(dateStr + 'T00:00:00Z');
  return Number.isFinite(ms) ? ms / 86400000 : NaN;
}

function calculateHotelTrip(params) {
  const startDay = dayNumber(params.start);
  const endDay = dayNumber(params.end);

  if (!Number.isFinite(startDay) || !Number.isFinite(endDay) || endDay <= startDay) {
    throw new Error('Некорректные даты поездки. Дата выезда должна быть позже даты заезда (формат YYYY-MM-DD).');
  }

  const guests = Number(params.guests);
  if (!Number.isInteger(guests) || guests < 1) {
    throw new Error('Укажите корректное количество гостей (целое число от 1).');
  }

  const occupancy = Number(params.occupancy) === 1 ? 1 : 2;
  const mealKey = params.mealKey && CONFIG.meals[params.mealKey] ? params.mealKey : 'none';
  const meal = CONFIG.meals[mealKey];

  const nights = endDay - startDay;
  const rooms = Math.ceil(guests / occupancy);
  const roomCost = rooms * nights * CONFIG.roomRate;
  const mealCost = guests * nights * meal.rate;
  const total = roomCost + mealCost;

  return {
    start: params.start,
    end: params.end,
    guests,
    occupancy,
    occupancyLabel: occupancy === 1 ? 'По 1 человеку в номере' : 'По 2 человека в номере',
    nights,
    rooms,
    roomRate: CONFIG.roomRate,
    mealKey,
    mealLabel: meal.label,
    mealRate: meal.rate,
    roomCost,
    mealCost,
    total,
    perPerson: Math.round(total / guests),
    transfer: params.transfer || 'Не выбран'
  };
}

module.exports = {
  CONFIG,
  calculateHotelTrip
};
