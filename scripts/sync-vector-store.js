'use strict';

require('dotenv').config();
const aiService = require('../services/aiService');
const vectorStoreService = require('../services/vectorStoreService');

async function main() {
  console.log('====================================================');
  console.log('🌲 Запуск синхронизации базы знаний BURABAY ECO HOTEL с OpenAI Vector Store');
  console.log('====================================================');

  const client = aiService.getClient();
  if (!client) {
    console.error('❌ Ошибка: API-ключ OpenAI не настроен в .env или базе данных.');
    process.exit(1);
  }

  try {
    const result = await vectorStoreService.syncPublicKnowledge(client);
    console.log('====================================================');
    console.log('✅ Синхронизация успешно завершена!');
    console.log(`📦 Vector Store Name: ${result.vectorStoreName}`);
    console.log(`🔑 Vector Store ID:   ${result.vectorStoreId}`);
    console.log(`📄 Загружено файлов:   ${result.indexedFilesCount}`);
    console.log(`📊 Статус индексации: ${result.status}`);
    console.log('====================================================');

    console.log('🔍 Проверочный запрос к File Search...');
    const searchTest = await vectorStoreService.testSearch(client, 'Каковы правила отмены бронирования и штрафы?');
    console.log('Ответ базы знаний:');
    console.log(searchTest.outputText);
    console.log('====================================================');
  } catch (err) {
    console.error('❌ Ошибка синхронизации Vector Store:', err.message);
    process.exit(1);
  }
}

main();

