'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const store = require('../data/store');
const aiService = require('../services/aiService');
const vectorStoreService = require('../services/vectorStoreService');

test('Vector Store configuration and indexed documents check', async () => {
  const client = aiService.getClient();
  assert.ok(client, 'OpenAI client должен быть доступен с валидным ключом');

  const status = await vectorStoreService.getStatus(client);
  assert.equal(status.configured, true, 'Vector Store должен быть сконфигурирован');
  assert.match(status.vectorStoreId, /^vs_[a-zA-Z0-9]+$/, 'ID должен начинаться с vs_');
  assert.equal(status.name, 'hotel-public-knowledge', 'Имя Vector Store должно совпадать');
  assert.equal(status.fileCounts.total, 10, 'Должно быть ровно 10 файлов в Vector Store');
  assert.equal(status.fileCounts.completed, 10, 'Все 10 файлов должны быть успешно проиндексированы');
});

test('Diagnostic testSearch against Vector Store returns accurate hotel policy', async () => {
  const client = aiService.getClient();
  const searchResult = await vectorStoreService.testSearch(client, 'Каковы правила отмены бронирования и штрафы?');

  assert.equal(searchResult.success, true);
  assert.equal(searchResult.status, 'completed');
  assert.match(searchResult.outputText, /72\s*час/i, 'Ответ должен содержать условие 72 часов');
  assert.match(searchResult.outputText, /18:00/i, 'Ответ должен содержать время 18:00');
  assert.match(searchResult.outputText, /перв(ой|ую)\s*ноч/i, 'Ответ должен упоминать штраф в размере первой ночи');
});

test('Responses API chat endpoint correctly answers questions via File Search', async () => {
  const result = await aiService.processMessage({
    sessionId: 'test_file_search_chat',
    message: 'Во сколько в отеле BURABAY ECO HOTEL заезд и выезд?',
    visitorId: 'test_guest'
  });

  assert.equal(result.mode, 'openai');
  assert.match(result.reply, /15:00/, 'Время заезда должно быть 15:00');
  assert.match(result.reply, /12:00/, 'Время выезда должно быть 12:00');
});

test('Responses API retains function calling for calculate_group_booking', async () => {
  const result = await aiService.processMessage({
    sessionId: 'test_calc_responses',
    message: 'Рассчитай групповое проживание с 2027-11-03 по 2027-11-05 на 20 человек, по два гостя в номере, завтрак',
    visitorId: 'test_guest'
  });

  assert.equal(result.mode, 'openai');
  assert.ok(result.calculation, 'Результат должен содержать расчет сметы');
  assert.equal(result.calculation.rooms, 10, 'Для 20 гостей по 2 в номере должно быть 10 номеров');
  assert.equal(result.calculation.nights, 2, 'Разница дат должна составлять 2 ночи');
});

