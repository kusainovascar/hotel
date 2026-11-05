'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const policy = require('../assistant-policy');
const store = require('../data/store');
const ai = require('../services/aiService');

const pricing = store.getPricing();
const context = () => store.getPublicAssistantContext();

describe('Тестирование групповых бронирований и логики калькулятора WGB', () => {

  describe('1. Обработка дат и отсутствие автоподстановки', () => {
    test('Если даты не указаны вообще, ассистент запрашивает даты или количество ночей (без автоподстановки)', () => {
      const result = policy.fallback('Рассчитай групповое проживание на 25 гостей', context());
      assert.match(result.reply, /даты/i, 'Должен спросить даты заезда и выезда или количество ночей');
      assert.equal(result.calculation, undefined, 'Расчёт не должен выполняться с выдуманными датами');
      assert.equal((result.reply.match(/\?/g) || []).length, 1, 'Должен быть ровно один уточняющий вопрос');
    });

    test('Если указано количество ночей (3 ночи) без дат — расчёт выполняется как ориентировочный', () => {
      // 25 гостей, 3 ночи, по 2 в номере, завтрак
      const trip = policy.calculate({
        guests: 25,
        nights: 3,
        occupancy: 2,
        mealKey: 'breakfast'
      }, pricing);

      assert.equal(trip.isApproximateDates, true, 'Должен быть флаг ориентировочных дат');
      assert.equal(trip.nights, 3, 'Количество ночей должно быть 3');
      assert.equal(trip.start, '', 'Дата заезда не должна быть выдумана');
      assert.equal(trip.end, '', 'Дата выезда не должна быть выдумана');
      assert.match(trip.datesLabel, /Без фиксированных дат.*3 ноч/i);
    });

    test('Fallback-ассистент корректно выполняет расчёт по количеству ночей без придумывания календарных дат', () => {
      const state = { guests: 25, nights: 3, occupancy: 2, mealKey: 'breakfast', calculationIntent: true };
      const result = policy.fallback('Рассчитай 25 гостей на 3 ночи по 2 в номере с завтраком', context(), state);

      assert.ok(result.calculation, 'Должен быть сформирован объект расчёта');
      assert.equal(result.calculation.nights, 3);
      assert.equal(result.calculation.isApproximateDates, true);
      assert.doesNotMatch(result.reply, /2026-\d{2}-\d{2}/, 'В ответе не должно быть выдуманных календарных дат');
      assert.match(result.reply, /без (?:точных|фиксированных) дат/i);
    });
  });

  describe('2. Нечётное количество гостей и детальная схема расселения', () => {
    test('25 гостей при двухместном расселении требуют 13 номеров: 12 двухместных и 1 с одноместным', () => {
      const trip = policy.calculate({
        guests: 25,
        nights: 3,
        occupancy: 2,
        mealKey: 'breakfast'
      }, pricing);

      assert.equal(trip.rooms, 13, '25 гостей по 2 в номере = 13 номеров');
      assert.equal(trip.doubleRooms, 12, '12 полноценных двухместных номеров');
      assert.equal(trip.singleRooms, 1, '1 номер с одноместным размещением для нечётного гостя');
      assert.match(trip.roomsBreakdown, /12 двухместных/);
      assert.match(trip.roomsBreakdown, /1 с одноместным размещением/);
    });

    test('Чётное количество гостей (20 гостей, по 2 в номере) — ровно 10 двухместных номеров', () => {
      const trip = policy.calculate({
        guests: 20,
        nights: 2,
        occupancy: 2,
        mealKey: 'breakfast'
      }, pricing);

      assert.equal(trip.rooms, 10);
      assert.equal(trip.doubleRooms, 10);
      assert.equal(trip.singleRooms, 0);
      assert.match(trip.roomsBreakdown, /10 двухместных ном/);
    });

    test('Одноместное расселение (15 гостей по 1 в номере) — 15 номеров', () => {
      const trip = policy.calculate({
        guests: 15,
        nights: 2,
        occupancy: 1,
        mealKey: 'none'
      }, pricing);

      assert.equal(trip.rooms, 15);
      assert.equal(trip.singleRooms, 15);
      assert.match(trip.roomsBreakdown, /15 одноместных/);
    });
  });

  describe('3. Трансфер без тарифа и разделение услуг', () => {
    test('Трансфер НЕ добавляется в итоговую сумму сметы', () => {
      const tripWithoutTransfer = policy.calculate({
        guests: 25,
        nights: 3,
        occupancy: 2,
        mealKey: 'breakfast',
        transfer: 'Не выбран'
      }, pricing);

      const tripWithTransfer = policy.calculate({
        guests: 25,
        nights: 3,
        occupancy: 2,
        mealKey: 'breakfast',
        transfer: 'Требуется'
      }, pricing);

      // Итоговая сумма должна быть строго одинаковой (проживание + питание), трансфер не прибавляется
      assert.equal(tripWithTransfer.total, tripWithoutTransfer.total, 'Трансфер без тарифа не должен увеличивать базовую смету');
      assert.equal(tripWithTransfer.transferIncludedInTotal, false, 'Флаг transferIncludedInTotal должен быть false');
      assert.match(tripWithTransfer.transferStatus, /рассчитывается отдельно/i);
    });

    test('Услуги четко разделены на включённые в смету и услуги по запросу', () => {
      const trip = policy.calculate({
        guests: 25,
        nights: 3,
        occupancy: 2,
        mealKey: 'breakfast',
        transfer: 'Требуется'
      }, pricing);

      assert.ok(Array.isArray(trip.includedServices), 'Должен быть массив включённых услуг');
      assert.ok(trip.includedServices.some(s => s.includes('Проживание')), 'Проживание должно быть в включённых услугах');
      assert.ok(trip.includedServices.some(s => s.includes('Питание')), 'Питание должно быть в включённых услугах');

      assert.ok(Array.isArray(trip.additionalServicesOnRequest), 'Должен быть массив доп. услуг по запросу');
      assert.ok(trip.additionalServicesOnRequest.some(s => s.includes('Трансфер') && s.includes('не входит в базовую смету')));
    });
  });

  describe('4. Формирование итоговой суммы, подтверждение наличия и следующий шаг', () => {
    test('Итоговая сумма и стоимость на человека рассчитываются математически точно', () => {
      // 25 гостей, 13 номеров, 3 ночи, тариф 30 000 ₸, завтрак 4 000 ₸
      const trip = policy.calculate({
        guests: 25,
        nights: 3,
        occupancy: 2,
        mealKey: 'breakfast'
      }, pricing);

      const expectedRoomCost = 13 * 3 * 30000; // 1 170 000 ₸
      const expectedMealCost = 25 * 3 * 4000;  // 300 000 ₸
      const expectedTotal = expectedRoomCost + expectedMealCost; // 1 470 000 ₸
      const expectedPerPerson = Math.round(expectedTotal / 25); // 58 800 ₸

      assert.equal(trip.roomCost, expectedRoomCost);
      assert.equal(trip.mealCost, expectedMealCost);
      assert.equal(trip.total, expectedTotal);
      assert.equal(trip.perPerson, expectedPerPerson);
    });

    test('Расчёт содержит предупреждение о неподтверждённом наличии и предложение следующего шага', () => {
      const trip = policy.calculate({
        guests: 25,
        nights: 3,
        occupancy: 2,
        mealKey: 'breakfast'
      }, pricing);

      assert.equal(trip.availabilityConfirmed, false);
      assert.match(trip.availabilityNote, /наличие свободных номеров.*требует.*подтверждения/i);
      assert.match(trip.nextStep, /заявку.*менеджер/i);
    });

    test('Инструмент aiService.executeTool возвращает структурированные данные и пояснение', async () => {
      const toolRes = await ai.executeTool('calculate_group_booking', {
        guestsCount: 25,
        nightsCount: 3,
        occupancyPerRoom: 2,
        mealType: 'breakfast',
        transferNeeded: true
      }, 'test_group_session');

      assert.equal(toolRes.success, true);
      assert.ok(toolRes.data);
      assert.equal(toolRes.data.rooms, 13);
      assert.equal(toolRes.data.nights, 3);
      assert.equal(toolRes.data.total, 1470000);
      assert.match(toolRes.displayText, /13 ном/);
      assert.match(toolRes.displayText, /12 двухместных.*1 с одноместным/);
      assert.match(toolRes.displayText, /Трансфер/);
      assert.match(toolRes.displayText, /наличие свободных номеров требует подтверждения/i);
      assert.match(toolRes.displayText, /предварительную заявку менеджеру/i);
    });
  });

});
