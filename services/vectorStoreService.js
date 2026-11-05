'use strict';

const fs = require('fs');
const path = require('path');
const store = require('../data/store');

const PUBLISHED_DOCS_DIR = path.join(__dirname, '..', 'knowledge-base', 'published');
const LEGACY_PUBLIC_DOCS_DIR = path.join(__dirname, '..', 'knowledge-base', 'public');

class VectorStoreService {
  /**
   * Подготовка каталога и генерация актуальных Markdown-файлов из опубликованных статей
   */
  generatePublishedDocs() {
    if (!fs.existsSync(PUBLISHED_DOCS_DIR)) {
      fs.mkdirSync(PUBLISHED_DOCS_DIR, { recursive: true });
    }

    // Очищаем только ранее сгенерированные файлы в dedicated каталоге published
    const existing = fs.readdirSync(PUBLISHED_DOCS_DIR);
    for (const file of existing) {
      if (file.endsWith('.md')) {
        try {
          fs.unlinkSync(path.join(PUBLISHED_DOCS_DIR, file));
        } catch (_) {}
      }
    }

    const generatedFiles = [];

    // 1. Сводный документ по тарифам и стоимости номеров из единого источника
    const pricing = store.getPricing();
    const pricingContent = `# Официальные тарифы отеля WGB Hotel & Restaurant
**Категория:** Номера и тарифы
**Статус тарифов:** ${pricing.status === 'verified' ? 'Подтверждённый тариф' : 'Демонстрационный тариф (demo)'}

- Базовый тариф за номер в сутки: ${pricing.roomRate.toLocaleString('ru-RU')} ₸
- Максимальная вместимость для групп: до ${pricing.maxGuests} человек
- Тарифы питания (за гостя в день):
  - Без питания: ${pricing.meals?.none?.rate || 0} ₸
  - Завтрак: ${pricing.meals?.breakfast?.rate || 4000} ₸
  - Полупансион (завтрак + ужин): ${pricing.meals?.half?.rate || 10000} ₸
  - Полный пансион (завтрак + обед + ужин): ${pricing.meals?.full?.rate || 15000} ₸
`;
    const pricingPath = path.join(PUBLISHED_DOCS_DIR, '00_wgb_tariffs.md');
    fs.writeFileSync(pricingPath, pricingContent, 'utf-8');
    generatedFiles.push(pricingPath);

    // 2. Генерация документов из опубликованных статей (status === 'published')
    const publishedArticles = store.getArticles({ status: 'published' });
    for (const article of publishedArticles) {
      const sanitizedId = String(article.id).replace(/[^a-zA-Z0-9_-]/g, '_');
      const filename = `${sanitizedId}.md`;
      const fullPath = path.join(PUBLISHED_DOCS_DIR, filename);

      const docContent = `# ${article.title}
**Категория:** ${article.category}
**Язык:** ${article.lang || 'ru'}
**Версия документа:** v${article.version || 1}
**Статус:** Официальные опубликованные сведения отеля WGB

${article.content}
`;
      fs.writeFileSync(fullPath, docContent, 'utf-8');
      generatedFiles.push(fullPath);
    }

    return generatedFiles;
  }

  /**
   * Управляемая синхронизация опубликованных статей с созданием нового Vector Store,
   * проверкой индексации и контрольным поиском перед переключением
   */
  async syncPublishedKnowledge(client) {
    if (!client) {
      throw new Error('OpenAI client не инициализирован. Проверьте API-ключ.');
    }

    store.updateSyncStatus({
      status: 'in_progress',
      lastError: null
    });

    try {
      const generatedFiles = this.generatePublishedDocs();
      if (generatedFiles.length === 0) {
        throw new Error('Нет опубликованных статей для синхронизации.');
      }

      console.log(`[VectorStoreService] Старт безопасной синхронизации. Подготовлено документов: ${generatedFiles.length}`);

      // 1. Создаем НОВЫЙ Vector Store перед любыми изменениями
      const newVsName = `wgb-hotel-knowledge-${Date.now()}`;
      const newVs = await client.vectorStores.create({
        name: newVsName,
        metadata: {
          project: 'WGB Hotel & Restaurant',
          version: '2.0',
          documentsCount: String(generatedFiles.length),
          environment: process.env.NODE_ENV || 'production'
        }
      });

      console.log(`[VectorStoreService] Создан новый Vector Store: ${newVs.id} (${newVs.name})`);

      // 2. Загружаем потоки всех опубликованных файлов и ждем завершения индексации
      const fileStreams = generatedFiles.map(filePath => fs.createReadStream(filePath));
      const fileBatch = await client.vectorStores.fileBatches.uploadAndPoll(newVs.id, {
        files: fileStreams
      });

      console.log(`[VectorStoreService] Индексация завершена. Статус: ${fileBatch.status}`);

      if (fileBatch.status !== 'completed') {
        throw new Error(`Индексация в OpenAI завершилась со статусом "${fileBatch.status}".`);
      }

      // 3. Контрольный диагностический поиск перед переключением активного хранилища
      console.log('[VectorStoreService] Выполнение контрольного поиска по новым данным...');
      const verifyPrompt = 'Кратко перечисли категории номеров и услуги отеля WGB';
      const verifyResponse = await client.responses.create({
        model: store.getSettings().model || 'gpt-4o-mini',
        tools: [{
          type: 'file_search',
          vector_store_ids: [newVs.id]
        }],
        input: verifyPrompt
      });

      const verificationSample = (verifyResponse.output_text || '').trim();
      if (!verificationSample) {
        throw new Error('Контрольный поиск по новому Vector Store не вернул ответа.');
      }

      console.log('[VectorStoreService] Контрольный поиск успешен! Образец ответа:', verificationSample.slice(0, 100));

      // 4. Только после успешной проверки переключаем активный Vector Store
      const currentActiveId = store.getSettings().vectorStoreId;
      const previousId = (currentActiveId && currentActiveId !== newVs.id) ? currentActiveId : (store.getSyncStatus().previousVectorStoreId || null);

      store.updateSettings({ vectorStoreId: newVs.id });
      process.env.OPENAI_VECTOR_STORE_ID = newVs.id;

      const history = Array.isArray(store.getSyncStatus().history) ? [...store.getSyncStatus().history] : [];
      history.unshift({
        vectorStoreId: newVs.id,
        previousVectorStoreId: previousId,
        timestamp: new Date().toISOString(),
        indexedFilesCount: generatedFiles.length,
        status: 'completed',
        verificationSample: verificationSample.slice(0, 200)
      });
      if (history.length > 10) history.length = 10;

      const updatedSyncStatus = store.updateSyncStatus({
        status: 'success',
        lastSyncAt: new Date().toISOString(),
        lastError: null,
        activeVectorStoreId: newVs.id,
        previousVectorStoreId: previousId,
        indexedFilesCount: generatedFiles.length,
        history
      });

      return {
        success: true,
        vectorStoreId: newVs.id,
        vectorStoreName: newVs.name,
        previousVectorStoreId: previousId,
        indexedFilesCount: generatedFiles.length,
        verificationSample: verificationSample.slice(0, 200),
        status: 'completed'
      };
    } catch (err) {
      console.error('[VectorStoreService] Ошибка синхронизации:', err.message);
      store.updateSyncStatus({
        status: 'error',
        lastError: err.message
      });
      throw err;
    }
  }

  /**
   * Откат к предыдущему сохраненному Vector Store
   */
  async rollbackVectorStore(client) {
    if (!client) {
      throw new Error('OpenAI client не настроен.');
    }

    const currentSync = store.getSyncStatus();
    const previousId = currentSync.previousVectorStoreId;

    if (!previousId) {
      throw new Error('Предыдущий Vector Store не найден для отката.');
    }

    // Проверяем доступность хранилища в OpenAI
    const retrieved = await client.vectorStores.retrieve(previousId);
    if (!retrieved || !retrieved.id) {
      throw new Error(`Хранилище ${previousId} недоступно в OpenAI.`);
    }

    const oldActive = store.getSettings().vectorStoreId;
    store.updateSettings({ vectorStoreId: previousId });
    process.env.OPENAI_VECTOR_STORE_ID = previousId;

    store.updateSyncStatus({
      activeVectorStoreId: previousId,
      previousVectorStoreId: oldActive,
      lastSyncAt: new Date().toISOString(),
      lastError: null
    });

    console.log(`[VectorStoreService] Успешный откат Vector Store с ${oldActive} на ${previousId}`);

    return {
      success: true,
      activeVectorStoreId: previousId,
      message: `Успешный откат к Vector Store ${previousId}`
    };
  }

  /**
   * Алиас для обратной совместимости со старыми скриптами
   */
  async syncPublicKnowledge(client, options = {}) {
    return this.syncPublishedKnowledge(client);
  }

  /**
   * Найти существующий или создать новый Vector Store для отеля
   */
  async getOrCreateVectorStore(client) {
    if (!client) {
      throw new Error('OpenAI client не инициализирован. Проверьте API-ключ.');
    }

    const savedId = process.env.OPENAI_VECTOR_STORE_ID || store.getSettings().vectorStoreId;
    if (savedId) {
      try {
        const existing = await client.vectorStores.retrieve(savedId);
        if (existing && existing.id) {
          return existing;
        }
      } catch (err) {
        console.warn(`Vector store с ID ${savedId} не найден или недоступен (${err.message}). Создаем новый...`);
      }
    }

    // Создание нового хранилища с брендом WGB
    const created = await client.vectorStores.create({
      name: 'wgb-hotel-knowledge',
      metadata: {
        project: 'WGB Hotel & Restaurant',
        environment: process.env.NODE_ENV || 'production'
      }
    });

    this.saveVectorStoreId(created.id);
    return created;
  }

  saveVectorStoreId(vectorStoreId) {
    if (!vectorStoreId) return;
    process.env.OPENAI_VECTOR_STORE_ID = vectorStoreId;
    try {
      store.updateSettings({ vectorStoreId });
      store.updateSyncStatus({ activeVectorStoreId: vectorStoreId });
    } catch (err) {
      console.error('Ошибка сохранения vectorStoreId в store:', err.message);
    }
  }

  /**
   * Получить диагностический статус векторного хранилища
   */
  async getStatus(client) {
    if (!client) {
      return {
        configured: false,
        message: 'OpenAI client не инициализирован (отсутствует API-ключ).'
      };
    }

    const vectorStoreId = process.env.OPENAI_VECTOR_STORE_ID || store.getSettings().vectorStoreId;
    if (!vectorStoreId) {
      return {
        configured: false,
        message: 'Vector Store ID не настроен в конфигурации сервера.'
      };
    }

    try {
      const vs = await client.vectorStores.retrieve(vectorStoreId);
      const files = await client.vectorStores.files.list(vectorStoreId, { limit: 50 });

      return {
        configured: true,
        vectorStoreId: vs.id,
        name: vs.name,
        status: vs.status,
        fileCounts: vs.file_counts,
        files: (files.data || []).map(f => ({
          id: f.id,
          status: f.status,
          created_at: f.created_at
        }))
      };
    } catch (err) {
      return {
        configured: false,
        vectorStoreId,
        error: err.message
      };
    }
  }

  /**
   * Тестовый диагностический запрос к File Search
   */
  async testSearch(client, query) {
    if (!client) throw new Error('OpenAI client не настроен.');
    const vs = await this.getOrCreateVectorStore(client);

    const testPrompt = query || 'Во сколько заезд и выезд в отеле?';
    const response = await client.responses.create({
      model: store.getSettings().model || 'gpt-4o-mini',
      tools: [{
        type: 'file_search',
        vector_store_ids: [vs.id]
      }],
      input: testPrompt
    });

    return {
      success: true,
      query: testPrompt,
      vectorStoreId: vs.id,
      outputText: response.output_text,
      status: response.status,
      usage: response.usage
    };
  }
}

module.exports = new VectorStoreService();
