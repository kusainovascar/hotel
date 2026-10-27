const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.WGB_DB_PATH || path.join(__dirname, 'database.json');
const policy = require('../assistant-policy');
const DEFAULT_PRICING = {status: 'demo', roomRate: 30000, maxGuests: 300, meals: {none: {label: 'Без питания', rate: 0}, breakfast: {label: 'Завтрак', rate: 4000}, half: {label: 'Завтрак и ужин', rate: 10000}, full: {label: 'Полный пансион', rate: 15000}}};

const DEFAULT_SYSTEM_PROMPT = policy.SYSTEM_POLICY;

const DEFAULT_KNOWLEDGE_BASE = [
  {
    id: 'kb_about',
    category: 'Отель и расположение',
    title: 'Общая информация об отеле WGB',
    content: 'WGB Hotel & Restaurant — концептуальный отель бизнес-класса, ориентированный на комфортные деловые поездки, корпоративные мероприятия и групповое размещение. Отель предлагает продуманные номера с рабочими зонами, ресторан с гибким планом питания и конференц-пространства. Круглосуточная стойка регистрации (24/7).',
    keywords: ['отель', 'wgb', 'расположение', 'где находится', 'информация', 'описание', 'звезды']
  },
  {
    id: 'kb_rooms',
    category: 'Номера и тарифы',
    title: 'Категории номеров и стоимость',
    content: 'В отеле представлены номера: 1) «Комфорт» для индивидуальных деловых поездок (один гость, большая кровать King-size, рабочая зона, кондиционер, чайная станция, Wi-Fi). 2) «Команда вместе / Твин» для групп (2 раздельные кровати или объединенные пространства, индивидуальная схема расселения). Базовый демонстрационный тариф — 30 000 ₸ за номер в сутки. Минимальная группа для спецтарифа — от 2 человек, вместимость до 300 гостей.',
    keywords: ['номера', 'комфорт', 'твин', 'стоимость', 'цена', 'тариф', 'категории', 'номер']
  },
  {
    id: 'kb_checkin',
    category: 'Правила проживания',
    title: 'Время заезда и выезда (Check-in / Check-out)',
    content: 'Время заезда — с 14:00 по местному времени. Время выезда — до 12:00. Ранний заезд и поздний выезд возможны при наличии свободных номеров и согласовываются индивидуально с администратором. Для заселения требуется документ, удостоверяющий личность (паспорт или удостоверение).',
    keywords: ['заезд', 'выезд', 'время заезда', 'check-in', 'check-out', 'ранний заезд', 'поздний выезд', 'часы']
  },
  {
    id: 'kb_dining',
    category: 'Ресторан и питание',
    title: 'Ресторан и тарифы на питание',
    content: 'Ресторан отеля WGB работает ежедневно. Доступны варианты питания: 1) Завтрак (шведский стол) — 4 000 ₸ за гостя в день (07:00 - 10:30). 2) Полупансион (завтрак + ужин) — 10 000 ₸ за гостя в день. 3) Полный пансион (завтрак + обед + ужин) — 15 000 ₸ за гостя в день. Для групп возможно составление индивидуального меню и организация кофе-брейков.',
    keywords: ['ресторан', 'питание', 'завтрак', 'обед', 'ужин', 'шведский стол', 'полупансион', 'пансион', 'еда', 'стоимость питания']
  },
  {
    id: 'kb_business',
    category: 'Деловые поездки',
    title: 'Командировки и документы для бухгалтерии',
    content: 'Для корпоративных клиентов и командировочных предоставляется полный пакет закрывающих документов: ЭСФ (электронные счет-фактуры), АВР (акты выполненных работ), фискальные чеки, справка о проживании. Оплата возможна по безналичному расчету от юридического лица, а также банковскими картами (Visa, MasterCard, Kaspi) и наличными.',
    keywords: ['командировка', 'документы', 'бухгалтерия', 'эсф', 'авр', 'чеки', 'безнал', 'оплата от компании', 'счет']
  },
  {
    id: 'kb_calculator',
    category: 'Групповые бронирования',
    title: 'Калькулятор группового проживания и Excel-план',
    content: 'На сайте отеля WGB работает интерактивный калькулятор: вы можете выбрать даты заезда и выезда, количество гостей (от 2 до 300), размещение (по 1 или по 2 человека в номере), план питания и трансфер. По итогам расчета формируется подробный файл Excel с формулами и сметой поездки, который можно скачать на устройство.',
    keywords: ['калькулятор', 'группа', 'расчет', 'excel', 'план поездки', 'групповое бронирование', 'смета']
  },
  {
    id: 'kb_transfer',
    category: 'Дополнительные услуги',
    title: 'Трансфер и транспортное обслуживание',
    content: 'Отель WGB организует встречу и проводы гостей в аэропорту и на ж/д вокзале. Для групп предоставляются комфортабельные микроавтобусы (Mercedes Sprinter), для индивидуальных гостей — автомобили комфорт- и бизнес-класса. Стоимость трансфера рассчитывается отдельно в зависимости от маршрута и количества пассажиров.',
    keywords: ['трансфер', 'аэропорт', 'такси', 'встреча', 'вокзал', 'машина', 'автобус']
  },
  {
    id: 'kb_amenities',
    category: 'Удобства и сервисы',
    title: 'Wi-Fi, парковка и прочие удобства',
    content: 'На всей территории отеля и в номерах действует бесплатный высокоскоростной Wi-Fi (до 200 Мбит/с). Для гостей на автомобилях доступна бесплатная охраняемая парковка с видеонаблюдением. В отеле также работают прачечная, камера хранения багажа и гладильные комнаты.',
    keywords: ['wifi', 'вайфай', 'интернет', 'парковка', 'машина', 'прачечная', 'багаж', 'утюг']
  }
];

class Store {
  constructor() {
    this.data = this.load();
  }

  getDefaults() {
    return {
      schemaVersion: 2,
      pricing: JSON.parse(JSON.stringify(DEFAULT_PRICING)),
      settings: {
        apiKey: process.env.OPENAI_API_KEY || '',
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        temperature: 0.2,
        maxTokens: 1200,
        isActive: true,
        welcomeMessage: 'Здравствуйте! Я виртуальный консультант WGB. Помогу подобрать номер, рассчитать групповое проживание или ответить на вопросы об отеле.',
        systemPrompt: DEFAULT_SYSTEM_PROMPT,
        bitrixWebhookUrl: process.env.BITRIX24_WEBHOOK_URL || '',
        dataRetentionDays: Number(process.env.DATA_RETENTION_DAYS) || 30
      },
      knowledgeBase: DEFAULT_KNOWLEDGE_BASE.map(item => ({...item, status: 'demo', isPublic: true})),
      leads: [],
      dialogs: {},
      analytics: {
        totalDialogs: 0,
        uniqueVisitors: [],
        totalLeads: 0,
        managerHandoffs: 0,
        totalTokens: 0,
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        estimatedCostUsd: 0,
        popularQuestions: {},
        popularServices: {}
      }
    };
  }

  load() {
    try {
      if (fs.existsSync(DB_PATH)) {
        const raw = fs.readFileSync(DB_PATH, 'utf-8');
        const parsed = JSON.parse(raw);
        // Объединяем с дефолтными значениями на случай обновления структуры
        const defaults = this.getDefaults();
        return {
          schemaVersion: 2,
          pricing: {...defaults.pricing, ...parsed.pricing, meals: {...defaults.pricing.meals, ...parsed.pricing?.meals}},
          settings: { ...defaults.settings, ...parsed.settings },
          knowledgeBase: Array.isArray(parsed.knowledgeBase) && parsed.knowledgeBase.length > 0 ? parsed.knowledgeBase.map(item => ({status: 'demo', isPublic: true, ...item})) : defaults.knowledgeBase,
          leads: Array.isArray(parsed.leads) ? parsed.leads : [],
          dialogs: parsed.dialogs || {},
          analytics: { ...defaults.analytics, ...parsed.analytics }
        };
      }
    } catch (err) {
      console.error('Ошибка загрузки database.json, создаем заново:', err);
    }

    const initial = this.getDefaults();
    this.save(initial);
    return initial;
  }

  save(dataToSave = this.data) {
    try {
      const dir = path.dirname(DB_PATH);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const temporary = DB_PATH + '.tmp';
      fs.writeFileSync(temporary, JSON.stringify(dataToSave, null, 2), {encoding: 'utf-8', mode: 0o600});
      fs.renameSync(temporary, DB_PATH);
    } catch (err) {
      console.error('Ошибка записи database.json:', err.message);
      throw err;
    }
  }

  getPricing() { return JSON.parse(JSON.stringify(this.data.pricing)); }

  updatePricing(pricing) {
    if (!['demo','verified'].includes(pricing.status) || !Number.isFinite(pricing.roomRate) || pricing.roomRate < 0 || !Number.isInteger(pricing.maxGuests) || pricing.maxGuests < 1 || pricing.maxGuests > 10000) throw new Error('Проверьте статус, тариф и количество гостей.');
    for (const key of ['none','breakfast','half','full']) {
      const meal = pricing.meals?.[key];
      if (!meal || typeof meal.label !== 'string' || !Number.isFinite(meal.rate) || meal.rate < 0) throw new Error('Проверьте тарифы питания.');
    }
    this.data.pricing = JSON.parse(JSON.stringify(pricing)); this.save();
    return this.getPricing();
  }

  getPublicAssistantContext() {
    const pricing = this.getPricing();
    const knowledgeBase = this.data.knowledgeBase.filter(item => item.isPublic !== false).map(({id,category,title,content,keywords,status}) => {
      // Legacy seed articles repeated prices. Structured pricing is authoritative.
      if (id === 'kb_rooms') content = content.replace(/Базовый демонстрационный тариф[^.]*\.|Минимальная группа[^.]*\./g, '').trim();
      if (id === 'kb_dining') content = content.replace(/[\d ][\d ]*\s*₸\/гостя|[\d ][\d ]*\s*₸ за гостя в день/g, 'по тарифу из расчёта');
      return {id,category,title,content,keywords,status: status || 'demo'};
    });
    return {pricing, knowledgeBase};
  }

  // Настройки
  getSettings() {
    return { ...this.data.settings };
  }

  updateSettings(newSettings) {
    this.data.settings = { ...this.data.settings, ...newSettings };
    this.save();
    return this.data.settings;
  }

  // База знаний
  getKnowledgeBase() {
    return [...this.data.knowledgeBase];
  }

  getKnowledgeBaseContext() {
    return this.getPublicAssistantContext().knowledgeBase
      .map(item => `### [${item.status === 'verified' ? 'Подтверждено' : 'Демонстрационные сведения'} / ${item.category}] ${item.title}\n${item.content}`)
      .join('\n\n');
  }

  saveKnowledgeItem(item) {
    const existingIndex = this.data.knowledgeBase.findIndex(i => i.id === item.id);
    if (existingIndex >= 0) {
      this.data.knowledgeBase[existingIndex] = { ...this.data.knowledgeBase[existingIndex], ...item };
    } else {
      const newItem = {
        id: item.id || `kb_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        category: item.category || 'Общее',
        title: item.title || 'Новая статья',
        content: item.content || '',
        status: item.status === 'verified' ? 'verified' : 'demo',
        isPublic: item.isPublic !== false,
        keywords: Array.isArray(item.keywords) ? item.keywords : []
      };
      this.data.knowledgeBase.push(newItem);
    }
    this.save();
    return this.data.knowledgeBase;
  }

  deleteKnowledgeItem(id) {
    this.data.knowledgeBase = this.data.knowledgeBase.filter(i => i.id !== id);
    this.save();
    return true;
  }

  // Заявки клиентов (Leads)
  addLead(leadData) {
    const lead = {
      id: `lead_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      name: leadData.name || 'Гость отеля',
      company: leadData.company || '',
      phone: leadData.phone || '',
      email: leadData.email || '',
      dates: leadData.dates || { start: '', end: '' },
      guests: Number(leadData.guests) || 1,
      rooms: Number(leadData.rooms) || 1,
      wishes: leadData.wishes || '',
      summary: leadData.summary || '',
      source: leadData.source || 'ai_agent',
      status: 'new', // new, in_progress, completed, cancelled
      crmStatus: 'pending', // pending, synced, error, not_configured
      crmError: null,
      crmId: null,
      createdAt: new Date().toISOString()
    };

    this.data.leads.unshift(lead);
    this.data.analytics.totalLeads = (this.data.analytics.totalLeads || 0) + 1;
    this.save();
    return lead;
  }

  getLeads() {
    return [...this.data.leads];
  }

  updateLead(id, updates) {
    const lead = this.data.leads.find(l => l.id === id);
    if (lead) {
      Object.assign(lead, updates);
      this.save();
      return lead;
    }
    return null;
  }

  // Диалоги
  getOrCreateDialog(sessionId, visitorId = 'anonymous') {
    if (!this.data.dialogs[sessionId]) {
      this.data.dialogs[sessionId] = {
        id: sessionId,
        visitorId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'active', // active, completed, manager_requested
        messages: []
      };

      this.data.analytics.totalDialogs = (this.data.analytics.totalDialogs || 0) + 1;
      if (!this.data.analytics.uniqueVisitors.includes(visitorId)) {
        this.data.analytics.uniqueVisitors.push(visitorId);
      }
      this.save();
    }
    return this.data.dialogs[sessionId];
  }

  appendMessage(sessionId, message) {
    const dialog = this.data.dialogs[sessionId];
    if (dialog) {
      dialog.messages.push({
        id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        role: message.role, // 'user', 'assistant', 'system'
        content: message.content,
        timestamp: new Date().toISOString(),
        metadata: message.metadata || null
      });
      dialog.updatedAt = new Date().toISOString();
      this.save();
    }
  }

  getDialogs() {
    return Object.values(this.data.dialogs).sort(
      (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)
    );
  }

  deleteDialog(sessionId) {
    if (this.data.dialogs[sessionId]) {
      delete this.data.dialogs[sessionId];
      this.save();
      return true;
    }
    return false;
  }

  purgeOldDialogs(daysRetention) {
    const threshold = new Date(Date.now() - (daysRetention || 30) * 86400000).toISOString();
    let removedCount = 0;
    for (const [id, dialog] of Object.entries(this.data.dialogs)) {
      if (dialog.updatedAt < threshold) {
        delete this.data.dialogs[id];
        removedCount++;
      }
    }
    if (removedCount > 0) {
      this.save();
    }
    return removedCount;
  }

  // Аналитика
  trackPopularQuestion(categoryOrKeyword) {
    if (!categoryOrKeyword) return;
    const cat = categoryOrKeyword.toLowerCase().trim();
    this.data.analytics.popularQuestions[cat] = (this.data.analytics.popularQuestions[cat] || 0) + 1;
    this.save();
  }

  trackPopularService(serviceName) {
    if (!serviceName) return;
    this.data.analytics.popularServices[serviceName] = (this.data.analytics.popularServices[serviceName] || 0) + 1;
    this.save();
  }

  trackManagerHandoff() {
    this.data.analytics.managerHandoffs = (this.data.analytics.managerHandoffs || 0) + 1;
    this.save();
  }

  trackTokenUsage(promptTokens = 0, completionTokens = 0, model = 'gpt-4o-mini') {
    const prompt = Number(promptTokens) || 0;
    const completion = Number(completionTokens) || 0;
    const total = prompt + completion;

    this.data.analytics.totalTokens = (this.data.analytics.totalTokens || 0) + total;
    this.data.analytics.totalPromptTokens = (this.data.analytics.totalPromptTokens || 0) + prompt;
    this.data.analytics.totalCompletionTokens = (this.data.analytics.totalCompletionTokens || 0) + completion;

    // Оценка стоимости в USD (gpt-4o-mini: ~$0.15/1M input, ~$0.60/1M output; gpt-4o: ~$2.50/1M in, $10/1M out)
    let promptRate = 0.15 / 1000000;
    let completionRate = 0.60 / 1000000;
    if (model.includes('gpt-4o') && !model.includes('mini')) {
      promptRate = 2.50 / 1000000;
      completionRate = 10.00 / 1000000;
    }

    const addedCost = (prompt * promptRate) + (completion * completionRate);
    this.data.analytics.estimatedCostUsd = Number(((this.data.analytics.estimatedCostUsd || 0) + addedCost).toFixed(5));
    this.save();
  }

  getAnalyticsSummary() {
    const dialogsList = Object.values(this.data.dialogs);
    const totalDialogs = dialogsList.length;
    const totalLeads = this.data.leads.length;
    const conversionRate = totalDialogs > 0 ? ((totalLeads / totalDialogs) * 100).toFixed(1) : 0;

    return {
      totalDialogs,
      uniqueVisitorsCount: this.data.analytics.uniqueVisitors.length,
      totalLeads,
      conversionRate: `${conversionRate}%`,
      managerHandoffs: this.data.analytics.managerHandoffs || 0,
      totalTokens: this.data.analytics.totalTokens || 0,
      totalPromptTokens: this.data.analytics.totalPromptTokens || 0,
      totalCompletionTokens: this.data.analytics.totalCompletionTokens || 0,
      estimatedCostUsd: this.data.analytics.estimatedCostUsd || 0,
      popularQuestions: this.data.analytics.popularQuestions || {},
      popularServices: this.data.analytics.popularServices || {},
      recentLeads: this.data.leads.slice(0, 5)
    };
  }
}

module.exports = new Store();
