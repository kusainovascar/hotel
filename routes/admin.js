'use strict';

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const store = require('../data/store');
const aiService = require('../services/aiService');
const crmService = require('../services/crmService');
const vectorStoreService = require('../services/vectorStoreService');

// Хранилище активных токенов сессий администраторов в памяти
const activeTokens = new Set();

// Пароль по умолчанию
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin12345';

/**
 * Middleware для защиты административных маршрутов
 */
function requireAdminAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const customHeader = req.headers['x-admin-token'];

  let token = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  } else if (customHeader) {
    token = customHeader.trim();
  }

  if (!token || !activeTokens.has(token)) {
    return res.status(401).json({
      error: 'Требуется авторизация администратора. Пожалуйста, войдите в панель управления.'
    });
  }

  next();
}

router.get('/pricing', requireAdminAuth, (req,res) => res.json(store.getPricing()));
router.put('/pricing', requireAdminAuth, (req,res) => {
  try { res.json({success: true, pricing: store.updatePricing(req.body)}); }
  catch(error) { res.status(400).json({error: error.message}); }
});

/**
 * Вход в панель администратора
 */
router.post('/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    const token = crypto.randomBytes(32).toString('hex');
    activeTokens.add(token);
    return res.json({
      success: true,
      token,
      message: 'Успешная авторизация в панели управления WGB'
    });
  }

  return res.status(401).json({
    success: false,
    error: 'Неверный пароль администратора'
  });
});

/**
 * Проверка валидности текущей сессии
 */
router.get('/verify-session', requireAdminAuth, (req, res) => {
  res.json({ authenticated: true });
});

/**
 * Выход из системы
 */
router.post('/logout', requireAdminAuth, (req, res) => {
  const token = req.headers['x-admin-token'] || req.headers['authorization']?.replace('Bearer ', '');
  if (token) {
    activeTokens.delete(token);
  }
  res.json({ success: true });
});

/**
 * Маскирование ключа API (показывает только первые 3 и последние 4 символа)
 */
function maskApiKey(key) {
  if (!key || typeof key !== 'string') return '';
  const trimmed = key.trim();
  if (trimmed.length <= 8) return '********';
  return `${trimmed.slice(0, 7)}...${trimmed.slice(-4)}`;
}

/**
 * Получение текущей конфигурации ИИ-агента
 */
router.get('/config', requireAdminAuth, (req, res) => {
  const settings = store.getSettings();
  res.json({
    ...settings,
    vectorStoreId: process.env.OPENAI_VECTOR_STORE_ID || settings.vectorStoreId || '',
    maskedApiKey: maskApiKey(settings.apiKey),
    hasKey: Boolean(settings.apiKey && settings.apiKey.trim().length > 5),
    // Сам ключ в открытом виде клиенту НЕ передается!
    apiKey: undefined
  });
});

/**
 * Сохранение конфигурации ИИ-агента
 */
router.post('/config', requireAdminAuth, (req, res) => {
  const {
    apiKey,
    model,
    temperature,
    maxTokens,
    isActive,
    welcomeMessage,
    systemPrompt,
    bitrixWebhookUrl,
    dataRetentionDays,
    vectorStoreId
  } = req.body;

  const currentSettings = store.getSettings();
  const updates = {};

  // Обновляем ключ только если пользователь явно ввел новый (а не маску)
  if (typeof apiKey === 'string' && apiKey.trim() && !apiKey.includes('...')) {
    updates.apiKey = apiKey.trim();
  }

  if (typeof model === 'string' && model.trim()) {
    updates.model = model.trim();
  }

  if (temperature !== undefined) {
    updates.temperature = Math.max(0, Math.min(2, Number(temperature) || 0.7));
  }

  if (maxTokens !== undefined) {
    updates.maxTokens = Math.max(50, Math.min(8192, Number(maxTokens) || 1200));
  }

  if (isActive !== undefined) {
    updates.isActive = Boolean(isActive);
  }

  if (typeof welcomeMessage === 'string' && welcomeMessage.trim()) {
    updates.welcomeMessage = welcomeMessage.trim();
  }

  if (typeof systemPrompt === 'string' && systemPrompt.trim()) {
    updates.systemPrompt = systemPrompt.trim();
  }

  if (typeof bitrixWebhookUrl === 'string') {
    updates.bitrixWebhookUrl = bitrixWebhookUrl.trim();
  }

  if (dataRetentionDays !== undefined) {
    updates.dataRetentionDays = Math.max(1, Math.min(365, Number(dataRetentionDays) || 30));
  }

  if (typeof vectorStoreId === 'string' && vectorStoreId.trim()) {
    updates.vectorStoreId = vectorStoreId.trim();
    process.env.OPENAI_VECTOR_STORE_ID = vectorStoreId.trim();
  }

  const updated = store.updateSettings(updates);

  res.json({
    success: true,
    message: 'Настройки успешно сохранены',
    config: {
      ...updated,
      maskedApiKey: maskApiKey(updated.apiKey),
      hasKey: Boolean(updated.apiKey && updated.apiKey.trim().length > 5),
      apiKey: undefined
    }
  });
});

/**
 * Проверка подключения к OpenAI API
 */
router.post('/test-connection', requireAdminAuth, async (req, res) => {
  const { apiKey, model } = req.body;
  // Если передан новый ключ (не маска) — проверяем его, иначе сохраненный
  const testKey = (apiKey && !apiKey.includes('...')) ? apiKey : null;
  const result = await aiService.testConnection(testKey, model);
  res.json(result);
});

/**
 * Проверка подключения к Bitrix24
 */
router.post('/test-crm', requireAdminAuth, async (req, res) => {
  const { webhookUrl } = req.body;
  const targetUrl = webhookUrl || store.getSettings().bitrixWebhookUrl;
  const result = await crmService.testConnection(targetUrl);
  res.json(result);
});

/**
 * База знаний: список статей
 */
router.get('/knowledge-base', requireAdminAuth, (req, res) => {
  res.json({ articles: store.getKnowledgeBase() });
});

/**
 * База знаний: создать или обновить статью
 */
router.post('/knowledge-base', requireAdminAuth, (req, res) => {
  const { id, category, title, content, keywords } = req.body;
  if (!title || !content) {
    return res.status(400).json({ error: 'Заголовок и содержимое статьи обязательны' });
  }

  const articles = store.saveKnowledgeItem({
    id,
    category: category || 'Общее',
    title,
    content,
    keywords: Array.isArray(keywords) ? keywords : (typeof keywords === 'string' ? keywords.split(',').map(s => s.trim()) : [])
  });

  res.json({ success: true, articles });
});

/**
 * База знаний: удалить статью
 */
router.delete('/knowledge-base/:id', requireAdminAuth, (req, res) => {
  store.deleteKnowledgeItem(req.params.id);
  res.json({ success: true, articles: store.getKnowledgeBase() });
});

/**
 * Заявки клиентов: список
 */
router.get('/leads', requireAdminAuth, (req, res) => {
  res.json({ leads: store.getLeads() });
});

/**
 * Заявки клиентов: обновление статуса
 */
router.patch('/leads/:id', requireAdminAuth, (req, res) => {
  const { status } = req.body;
  const updated = store.updateLead(req.params.id, { status });
  if (!updated) {
    return res.status(404).json({ error: 'Заявка не найдена' });
  }
  res.json({ success: true, lead: updated });
});

/**
 * Заявки клиентов: повторная синхронизация с Bitrix24
 */
router.post('/leads/:id/sync-crm', requireAdminAuth, async (req, res) => {
  const lead = store.getLeads().find(l => l.id === req.params.id);
  if (!lead) {
    return res.status(404).json({ error: 'Заявка не найдена' });
  }

  const settings = store.getSettings();
  if (!settings.bitrixWebhookUrl) {
    return res.status(400).json({ error: 'Вебхук Bitrix24 не настроен в конфигурации' });
  }

  const result = await crmService.sendLeadToBitrix(lead, settings.bitrixWebhookUrl);
  store.updateLead(lead.id, {
    crmStatus: result.status,
    crmId: result.crmId || null,
    crmError: result.success ? null : result.message
  });

  res.json(result);
});

/**
 * Диалоги: список сессий и переписки
 */
router.get('/dialogs', requireAdminAuth, (req, res) => {
  res.json({ dialogs: store.getDialogs() });
});

/**
 * Диалоги: удаление персональных данных диалога (GDPR / закон о ПД)
 */
router.delete('/dialogs/:id', requireAdminAuth, (req, res) => {
  const deleted = store.deleteDialog(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: 'Диалог не найден' });
  }
  res.json({ success: true, message: 'Диалог и связанные персональные данные успешно удалены' });
});

/**
 * Диалоги: очистка устаревших диалогов по сроку хранения
 */
router.post('/dialogs/purge', requireAdminAuth, (req, res) => {
  const settings = store.getSettings();
  const removed = store.purgeOldDialogs(settings.dataRetentionDays);
  res.json({
    success: true,
    removedCount: removed,
    message: `Удалено ${removed} диалогов, превысивших срок хранения (${settings.dataRetentionDays} дн.)`
  });
});

/**
 * Аналитика и статистика
 */
router.get('/analytics', requireAdminAuth, (req, res) => {
  res.json(store.getAnalyticsSummary());
});



/**
 * OpenAI Vector Store: статус
 */
router.get('/vector-store', requireAdminAuth, async (req, res) => {
  const client = aiService.getClient();
  const status = await vectorStoreService.getStatus(client);
  res.json(status);
});

/**
 * OpenAI Vector Store: запуск синхронизации публичных документов
 */
router.post('/vector-store/sync', requireAdminAuth, async (req, res) => {
  const client = aiService.getClient();
  if (!client) return res.status(400).json({ error: 'API-ключ OpenAI не настроен' });
  try {
    const result = await vectorStoreService.syncPublicKnowledge(client);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * OpenAI Vector Store: тестовый диагностический поиск
 */
router.post('/vector-store/test', requireAdminAuth, async (req, res) => {
  const client = aiService.getClient();
  if (!client) return res.status(400).json({ error: 'API-ключ OpenAI не настроен' });
  try {
    const result = await vectorStoreService.testSearch(client, req.body?.query);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
