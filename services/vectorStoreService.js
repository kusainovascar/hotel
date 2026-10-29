'use strict';

const fs = require('fs');
const path = require('path');
const store = require('../data/store');

const VECTOR_STORE_NAME = 'hotel-public-knowledge';
const PUBLIC_DOCS_DIR = path.join(__dirname, '..', 'knowledge-base', 'public');

class VectorStoreService {
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

    // Поиск по имени
    try {
      const list = await client.vectorStores.list({ limit: 50 });
      const found = list.data.find(v => v.name === VECTOR_STORE_NAME);
      if (found) {
        this.saveVectorStoreId(found.id);
        return found;
      }
    } catch (err) {
      console.warn('Не удалось получить список Vector Stores:', err.message);
    }

    // Создание нового хранилища
    const created = await client.vectorStores.create({
      name: VECTOR_STORE_NAME,
      metadata: {
        project: 'BURABAY ECO HOTEL',
        environment: process.env.NODE_ENV || 'production'
      }
    });

    this.saveVectorStoreId(created.id);
    return created;
  }

  /**
   * Сохранить идентификатор в настройках сервера
   */
  saveVectorStoreId(vectorStoreId) {
    if (!vectorStoreId) return;
    process.env.OPENAI_VECTOR_STORE_ID = vectorStoreId;
    try {
      store.updateSettings({ vectorStoreId });
    } catch (err) {
      console.error('Ошибка сохранения vectorStoreId в store:', err.message);
    }
  }

  /**
   * Синхронизация 10 публичных документов в Vector Store без создания дубликатов
   */
  async syncPublicKnowledge(client, options = {}) {
    if (!client) {
      throw new Error('OpenAI client обязателен для синхронизации Vector Store.');
    }

    if (!fs.existsSync(PUBLIC_DOCS_DIR)) {
      throw new Error(`Директория с публичными документами не найдена: ${PUBLIC_DOCS_DIR}`);
    }

    const filenames = fs.readdirSync(PUBLIC_DOCS_DIR)
      .filter(f => f.endsWith('.md'))
      .sort();

    if (filenames.length === 0) {
      throw new Error(`В папке ${PUBLIC_DOCS_DIR} не найдено Markdown-документов.`);
    }

    console.log(`[VectorStoreService] Старт синхронизации. Документов в папке: ${filenames.length}`);

    // Получаем или создаем векторное хранилище
    const vectorStore = await this.getOrCreateVectorStore(client);
    const vectorStoreId = vectorStore.id;

    // Проверяем существующие файлы в векторном хранилище для исключения дубликатов
    try {
      const existingFilesList = await client.vectorStores.files.list(vectorStoreId, { limit: 100 });
      if (existingFilesList && existingFilesList.data && existingFilesList.data.length > 0) {
        console.log(`[VectorStoreService] В хранилище найдено ${existingFilesList.data.length} ранее загруженных файлов. Очистка старых версий для исключения дубликатов...`);
        for (const vsFile of existingFilesList.data) {
          try {
            await client.vectorStores.files.del(vectorStoreId, vsFile.id);
            await client.files.del(vsFile.id).catch(() => {});
          } catch (delErr) {
            console.warn(`[VectorStoreService] Предупреждение при удалении файла ${vsFile.id}:`, delErr.message);
          }
        }
      }
    } catch (checkErr) {
      console.warn('[VectorStoreService] Не удалось проверить список существующих файлов:', checkErr.message);
    }

    // Подготовка потоков чтения файлов
    const fileStreams = filenames.map(fname => {
      const fullPath = path.join(PUBLIC_DOCS_DIR, fname);
      return fs.createReadStream(fullPath);
    });

    console.log(`[VectorStoreService] Загрузка и запуск индексации для ${fileStreams.length} файлов в Vector Store ${vectorStoreId}...`);

    // Загрузка и ожидание завершения индексации
    const fileBatch = await client.vectorStores.fileBatches.uploadAndPoll(vectorStoreId, {
      files: fileStreams
    });

    console.log(`[VectorStoreService] Индексация завершена. Статус: ${fileBatch.status}, файлы:`, fileBatch.file_counts);

    this.saveVectorStoreId(vectorStoreId);

    return {
      success: fileBatch.status === 'completed',
      status: fileBatch.status,
      vectorStoreId,
      vectorStoreName: vectorStore.name,
      fileCounts: fileBatch.file_counts,
      indexedFilesCount: filenames.length,
      files: filenames
    };
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

    const testPrompt = query || 'Во сколько заезд и выезд в отеле BURABAY ECO HOTEL?';
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

