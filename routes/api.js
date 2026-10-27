'use strict';

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const store = require('../data/store');
const aiService = require('../services/aiService');
const policy = require('../assistant-policy');
const { calculateHotelTrip } = require('../services/hotelCalculator');
const crmService = require('../services/crmService');

// Ограничение частоты запросов к чату для предотвращения злоупотреблений
const chatLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 минута
  max: 30, // макс. 30 сообщений в минуту на 1 IP
  message: {
    error: 'Слишком много запросов. Пожалуйста, подождите минуту перед следующим сообщением.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * Получить публичный статус ИИ-агента (без секретных данных)
 */
router.get('/agent/status', (req, res) => {
  const settings = store.getSettings();
  res.json({
    isActive: Boolean(settings.isActive),
    welcomeMessage: settings.welcomeMessage,
    hasApiKey: Boolean(settings.apiKey && settings.apiKey.trim().length > 5)
  });
});

/**
 * Отправить сообщение ИИ-консультанту
 */
router.post('/chat', chatLimiter, async (req, res) => {
  try {
    const { sessionId, message, visitorId } = req.body || {};

    if (!sessionId || typeof sessionId !== 'string') {
      return res.status(400).json({ error: 'Параметр sessionId обязателен' });
    }

    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'Текст сообщения не может быть пустым' });
    }

    let cleanMessage;
    try { cleanMessage = policy.validateMessage(message); }
    catch(error) { return res.status(400).json({error: error.message}); }
    if (sessionId.length > 128 || !/^[A-Za-z0-9_-]+$/.test(sessionId) || ['__proto__','constructor','prototype'].includes(sessionId)) return res.status(400).json({error:'Некорректный sessionId'});
    const cleanVisitorId = (visitorId && typeof visitorId === 'string') ? visitorId.slice(0, 64) : 'guest';

    const result = await aiService.processMessage({
      sessionId,
      message: cleanMessage,
      visitorId: cleanVisitorId
    });

    res.json(result);
  } catch (err) {
    console.error('Ошибка в роуте /api/chat:', err);
    res.status(500).json({
      error: 'Внутренняя ошибка сервера при обработке сообщения',
      details: 'Попробуйте повторить запрос позже.'
    });
  }
});

/**
 * Получить историю диалога по sessionId
 */
router.get('/chat/history/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const dialog = store.data.dialogs[sessionId];
  if (!dialog) {
    return res.json({ messages: [] });
  }
  res.json({ messages: dialog.messages });
});

/**
 * Прямое создание заявки клиентом (например, из формы виджета или кнопки "Связаться с менеджером")
 */
router.get('/agent/knowledge', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(store.getPublicAssistantContext());
});

router.post('/lead', async (req, res) => {
  if (req.body?.consentConfirmed !== true) return res.status(400).json({error: 'Подтвердите согласие на обработку и передачу контактов менеджеру.'});
  try {
    const { name, phone, email, company, dates, guests, rooms, wishes, summary, sessionId } = req.body;

    if (!name || !phone) {
      return res.status(400).json({ error: 'Имя и телефон обязательны для заполнения' });
    }

    const settings = store.getSettings();
    const lead = store.addLead({
      name,
      phone,
      email,
      company,
      dates,
      guests,
      rooms,
      wishes,
      summary: summary || 'Прямая заявка от клиента с сайта',
      source: 'web_form'
    });

    // Отправка в Bitrix24
    if (settings.bitrixWebhookUrl) {
      crmService.sendLeadToBitrix(lead, settings.bitrixWebhookUrl).then(res => {
        store.updateLead(lead.id, {
          crmStatus: res.status,
          crmId: res.crmId || null,
          crmError: res.success ? null : res.message
        });
      }).catch(console.error);
    } else {
      store.updateLead(lead.id, { crmStatus: 'not_configured' });
    }

    if (sessionId) {
      store.appendMessage(sessionId, {
        role: 'assistant',
        content: `Спасибо, ${name}! Ваша заявка успешно принята (№ ${lead.id.slice(-6)}). Менеджер отеля свяжется с вами в ближайшее время по номеру ${phone}.`,
        metadata: { leadCreated: true, leadId: lead.id }
      });
    }

    res.json({ success: true, lead });
  } catch (err) {
    console.error('Ошибка создания лида:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Серверный калькулятор группового проживания
 */
router.post('/calculator/calculate', (req, res) => {
  try {
    const result = calculateHotelTrip(req.body);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

module.exports = router;
