'use strict';

const { test, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Изолированная временная база данных для тестирования (защита пользовательских данных)
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wgb-unified-kb-test-'));
const tempDbPath = path.join(tempDir, 'database.json');
process.env.WGB_DB_PATH = tempDbPath;
process.env.OPENAI_API_KEY = '';

const store = require('../data/store');
const ai = require('../services/aiService');
const policy = require('../assistant-policy');
const vectorStoreService = require('../services/vectorStoreService');

after(() => {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch (_) {}
});

describe('1. Модель единой базы знаний: создание, редактирование, версии и черновики', () => {
  let createdArticleId = null;

  test('Создание новой статьи в статусе черновика (draft)', () => {
    const article = store.saveArticle({
      title: 'Конференц-зал «Астана»',
      category: 'Мероприятия',
      content: 'Отель WGB располагает современным конференц-залом на 120 человек с мультимедиа.',
      lang: 'ru',
      status: 'draft',
      keywords: ['конференц', 'зал', 'мероприятия']
    });

    assert.ok(article.id, 'Статья должна получить ID');
    assert.equal(article.status, 'draft', 'Статус должен быть draft');
    assert.equal(article.version, 1, 'Начальная версия должна быть 1');
    assert.equal(article.lang, 'ru', 'Язык по умолчанию ru');
    assert.ok(article.updatedAt, 'Должна быть зафиксирована дата изменения');
    assert.deepEqual(article.history, [], 'У новой статьи история пуста');

    createdArticleId = article.id;

    // Черновик НЕ должен попадать в публичный контекст
    const publicCtx = store.getPublicAssistantContext();
    const inPublic = publicCtx.knowledgeBase.find(a => a.id === createdArticleId);
    assert.equal(inPublic, undefined, 'Черновик не должен присутствовать в публичном контексте ИИ');

    // Черновик НЕ должен возвращаться в результатах поиска
    const searchResults = store.searchPublicKnowledge('Конференц-зал «Астана»');
    const draftFound = searchResults.some(r => r.title === 'Конференц-зал «Астана»');
    assert.equal(draftFound, false, 'Поиск не должен находить неопубликованный черновик');
  });

  test('Редактирование статьи сохраняет историю предыдущих версий', () => {
    assert.ok(createdArticleId);

    const updated = store.saveArticle({
      id: createdArticleId,
      title: 'Конференц-зал «Астана» Бизнес',
      category: 'Мероприятия',
      content: 'Отель WGB располагает конференц-залом на 150 человек с синхронным переводом.',
      lang: 'ru',
      status: 'draft'
    });

    assert.equal(updated.version, 2, 'Версия должна инкрементироваться до 2');
    assert.equal(updated.title, 'Конференц-зал «Астана» Бизнес');
    assert.equal(updated.history.length, 1, 'История должна содержать снимок версии 1');
    assert.equal(updated.history[0].version, 1);
    assert.equal(updated.history[0].title, 'Конференц-зал «Астана»');
  });

  test('Восстановление предыдущей версии статьи из истории', () => {
    assert.ok(createdArticleId);

    const restored = store.restoreArticleVersion(createdArticleId, 1);
    assert.equal(restored.version, 3, 'Версия после восстановления должна стать 3');
    assert.equal(restored.title, 'Конференц-зал «Астана»', 'Заголовок должен вернуться к версии 1');
    assert.match(restored.content, /120 человек/, 'Контент должен вернуться к версии 1');
    assert.equal(restored.history.length, 2, 'В истории теперь должны быть зафиксированы версия 2 и версия 1');
  });

  test('Публикация статьи открывает доступ для ИИ-ассистента', () => {
    assert.ok(createdArticleId);

    const published = store.publishArticle(createdArticleId);
    assert.equal(published.status, 'published', 'Статус должен смениться на published');
    assert.equal(published.version, 4, 'Версия должна увеличиться при публикации');

    // Теперь статья присутствует в публичном контексте
    const publicCtx = store.getPublicAssistantContext();
    const inPublic = publicCtx.knowledgeBase.find(a => a.id === createdArticleId);
    assert.ok(inPublic, 'Опубликованная статья должна появиться в публичном контексте');
    assert.equal(inPublic.title, 'Конференц-зал «Астана»');

    // Поиск теперь находит статью
    const searchResults = store.searchPublicKnowledge('конференц');
    assert.ok(searchResults.length > 0, 'Опубликованная статья должна находиться поиском');
    assert.match(searchResults[0].content, /конференц-залом/i);
  });

  test('Снятие статьи с публикации (в черновик) снова скрывает её от ИИ', () => {
    assert.ok(createdArticleId);

    const unpublished = store.unpublishArticle(createdArticleId);
    assert.equal(unpublished.status, 'draft');

    const publicCtx = store.getPublicAssistantContext();
    const inPublic = publicCtx.knowledgeBase.find(a => a.id === createdArticleId);
    assert.equal(inPublic, undefined, 'После снятия с публикации статья не должна быть в публичном контексте');
  });
});

describe('2. Защита от устаревших тарифов и категорий номеров', () => {
  test('Обновление тарифов и категорий номеров немедленно отражается в ответах ассистента', () => {
    // 1. Проверяем базовый ответ по номерам
    const initialContext = store.getPublicAssistantContext();
    const initialReply = policy.fallback('Какие категории номеров есть в отеле?', initialContext);
    assert.match(initialReply.reply, /Комфорт|Твин/i, 'Должны упоминаться категории из базы WGB');
    assert.doesNotMatch(initialReply.reply, /Standard Forest|Superior Nature|Family Suite|Panorama Suite/i, 'Не должно быть английских названий из сторонней базы');

    // 2. Обновляем категорию номеров в базе
    const roomsArticle = store.getArticles().find(a => a.id === 'kb_rooms');
    assert.ok(roomsArticle);

    store.saveArticle({
      id: 'kb_rooms',
      category: 'Номера и тарифы',
      title: 'Категории номеров и стоимость',
      content: 'В отеле WGB представлены обновленные категории: 1) «Деловой Люкс WGB» с панорамным видом; 2) «Апартаменты Премиум».',
      status: 'published'
    });

    const updatedContext = store.getPublicAssistantContext();
    const updatedReply = policy.fallback('Какие категории номеров есть в отеле?', updatedContext);

    assert.match(updatedReply.reply, /Деловой Люкс WGB|Апартаменты Премиум/i, 'ИИ должен ответить обновленными категориями');
    assert.doesNotMatch(updatedReply.reply, /Standard Forest|Superior Nature/i, 'Старые сторонние категории не должны использоваться');
  });

  test('Ассистент сообщает об отсутствии подтвержденных сведений при неизвестном запросе', () => {
    const context = store.getPublicAssistantContext();
    const result = policy.fallback('Есть ли у вас вертолетная площадка на крыше и сколько стоит посадка?', context);
    assert.match(result.reply, /нет информации|не могу подтвердить|связаться|уточн/i, 'Ассистент должен сообщить об отсутствии подтверждённой информации');
  });
});

describe('3. Генератор документов для Vector Store', () => {
  test('Генерирует файлы только для опубликованных статей и не смешивает с черновиками', () => {
    // Создаем тестовый черновик
    const draft = store.saveArticle({
      title: 'Секретная неопубликованная акция',
      category: 'Акции',
      content: 'Скидка 99% для всех.',
      status: 'draft'
    });

    const generated = vectorStoreService.generatePublishedDocs();
    assert.ok(generated.length > 0, 'Должны быть сгенерированы документы');

    // Проверяем, что черновик НЕ вошел в список файлов
    const draftFile = generated.find(f => f.includes(draft.id));
    assert.equal(draftFile, undefined, 'Черновик не должен генерироваться в каталог published');

    // Проверяем, что файл тарифов сгенерирован
    const tariffsFile = generated.find(f => f.includes('00_wgb_tariffs.md'));
    assert.ok(tariffsFile, 'Файл тарифов должен быть сгенерирован');
    const tariffsContent = fs.readFileSync(tariffsFile, 'utf-8');
    assert.match(tariffsContent, /WGB Hotel & Restaurant/);
    assert.match(tariffsContent, /30\s*000/);

    // Удаляем тестовый черновик
    store.deleteArticle(draft.id);
  });
});

describe('4. Безопасность и сохранение данных при перезапуске', () => {
  test('Данные сохраняются атомарно и корректно перезагружаются из JSON-хранилища', () => {
    const currentArticlesCount = store.getArticles().length;
    assert.ok(currentArticlesCount >= 8, 'Должно быть не менее 8 базовых статей');

    // Создаем новую статью
    const newArt = store.saveArticle({
      title: 'Тест персистентности',
      category: 'Тест',
      content: 'Тестовый текст персистентности.',
      status: 'published'
    });

    // Создаем новый экземпляр Store, симулирующий перезапуск приложения
    const StoreClass = store.constructor;
    const reloadedStore = new StoreClass();
    const found = reloadedStore.getArticle(newArt.id);

    assert.ok(found, 'Статья должна сохраниться после перезагрузки store');
    assert.equal(found.title, 'Тест персистентности');
    assert.equal(found.status, 'published');

    // Удаляем созданную тестовую статью
    reloadedStore.deleteArticle(newArt.id);
  });
});
