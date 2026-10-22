'use strict';

// Состояние административной панели
const state = {
  token: localStorage.getItem('wgb_admin_token') || null,
  activeTab: 'tab-analytics',
  config: null,
  analytics: null,
  knowledgeBase: [],
  leads: [],
  dialogs: [],
  selectedDialogId: null
};

// Хелпер для запросов с авторизацией
async function apiFetch(endpoint, options = {}) {
  const headers = options.headers || {};
  if (state.token) {
    headers['X-Admin-Token'] = state.token;
  }
  if (!headers['Content-Type'] && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(endpoint, { ...options, headers });
  if (res.status === 401) {
    handleUnauthorized();
    throw new Error('Сессия истекла. Войдите снова.');
  }

  return res.json();
}

function showToast(message, isError = false) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.style.background = isError ? 'var(--danger)' : 'var(--ink)';
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3500);
}

function handleUnauthorized() {
  state.token = null;
  localStorage.removeItem('wgb_admin_token');
  document.getElementById('login-modal').hidden = false;
  document.getElementById('admin-app').hidden = true;
}

// Инициализация при загрузке
document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();

  if (state.token) {
    try {
      const verify = await apiFetch('/api/admin/verify-session');
      if (verify.authenticated) {
        showApp();
        return;
      }
    } catch (e) {
      handleUnauthorized();
    }
  } else {
    handleUnauthorized();
  }
});

function showApp() {
  document.getElementById('login-modal').hidden = true;
  document.getElementById('admin-app').hidden = false;
  loadInitialData();
}

// Установка слушателей событий
function setupEventListeners() {
  // Форма входа
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pwdInput = document.getElementById('admin-password');
    const errEl = document.getElementById('login-error');
    errEl.hidden = true;

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pwdInput.value })
      });
      const data = await res.json();
      if (res.ok && data.token) {
        state.token = data.token;
        localStorage.setItem('wgb_admin_token', data.token);
        pwdInput.value = '';
        showApp();
        showToast('Добро пожаловать в панель управления!');
      } else {
        errEl.textContent = data.error || 'Неверный пароль';
        errEl.hidden = false;
      }
    } catch (err) {
      errEl.textContent = 'Ошибка связи с сервером';
      errEl.hidden = false;
    }
  });

  // Показать/скрыть пароль
  document.getElementById('toggle-pwd-btn').addEventListener('click', () => {
    const input = document.getElementById('admin-password');
    input.type = input.type === 'password' ? 'text' : 'password';
  });

  // Выход
  document.getElementById('logout-btn').addEventListener('click', async () => {
    try {
      await apiFetch('/api/admin/logout', { method: 'POST' });
    } catch (e) {}
    handleUnauthorized();
    showToast('Вы вышли из системы');
  });

  // Переключение вкладок
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.dataset.tab;
      switchTab(tabId);
    });
  });

  // Кнопка быстрого перехода к заявкам
  document.getElementById('goto-all-leads-btn')?.addEventListener('click', () => {
    switchTab('tab-leads');
  });

  // Обновить данные
  document.getElementById('refresh-data-btn').addEventListener('click', () => {
    loadTabData(state.activeTab);
    showToast('Данные обновлены');
  });

  // Ползунок температуры
  document.getElementById('cfg-temperature').addEventListener('input', (e) => {
    document.getElementById('temp-val').textContent = e.target.value;
  });

  // Проверка подключения OpenAI
  document.getElementById('test-connection-btn').addEventListener('click', testOpenAiConnection);

  // Сохранение настроек OpenAI
  document.getElementById('openai-settings-form').addEventListener('submit', saveOpenAiSettings);

  // Проверка CRM Bitrix24
  document.getElementById('test-crm-btn').addEventListener('click', testCrmWebhook);

  // Сохранение CRM настроек
  document.getElementById('crm-settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = document.getElementById('cfg-bitrix-url').value.trim();
    await saveConfigField({ bitrixWebhookUrl: url });
    showToast('Вебхук Bitrix24 сохранен');
  });

  // Срок хранения (GDPR)
  document.getElementById('retention-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const days = Number(document.getElementById('cfg-retention').value);
    await saveConfigField({ dataRetentionDays: days });
    showToast(`Срок хранения обновлен (${days} дн.)`);
  });

  document.getElementById('purge-old-btn').addEventListener('click', async () => {
    if (!confirm('Вы уверены, что хотите удалить все диалоги старше установленного срока хранения?')) return;
    try {
      const res = await apiFetch('/api/admin/dialogs/purge', { method: 'POST' });
      showToast(res.message);
      loadDialogs();
    } catch (err) {
      showToast(err.message, true);
    }
  });

  // Сохранение промпта
  document.getElementById('save-prompt-btn').addEventListener('click', async () => {
    const promptText = document.getElementById('cfg-prompt').value;
    await saveConfigField({ systemPrompt: promptText });
    showToast('Системный промпт успешно сохранен');
  });

  // Сброс промпта к базовому
  document.getElementById('reset-prompt-btn').addEventListener('click', () => {
    if (!confirm('Сбросить инструкцию к стандартному тексту из требований?')) return;
    const defaultPrompt = `Ты — виртуальный консультант отеля WGB.

Твоя задача — помогать гостям выбирать услуги отеля, получать информацию о проживании и оформлять заявки на индивидуальное и групповое бронирование.

Общайся естественно, профессионально и доброжелательно.

Определяй язык пользователя и отвечай на этом языке. Поддерживай русский, казахский и английский.

Не задавай много вопросов одновременно. Уточняй только информацию, необходимую для решения задачи клиента.

Если посетитель интересуется групповым проживанием, последовательно собери информацию о датах, количестве гостей, номерах, питании и дополнительных услугах.

Используй только подтверждённые данные из базы знаний и подключённых систем.

Не придумывай цены, скидки, наличие номеров и условия бронирования.

Не обещай скидки и не подтверждай бронирования без данных из соответствующей системы.

После сбора необходимой информации предложи отправить заявку менеджеру.

Перед сбором и передачей персональных данных предоставь пользователю информацию об их обработке и получи необходимое согласие.

Твоя главная бизнес-задача — помочь посетителю решить его вопрос и, когда это уместно, преобразовать заинтересованность в качественную заявку на бронирование.`;
    document.getElementById('cfg-prompt').value = defaultPrompt;
  });

  // База знаний: модальное окно
  const kbModal = document.getElementById('kb-modal');
  document.getElementById('new-kb-btn').addEventListener('click', () => {
    document.getElementById('kb-modal-title').textContent = 'Добавление статьи базы знаний';
    document.getElementById('kb-id').value = '';
    document.getElementById('kb-category').value = '';
    document.getElementById('kb-title').value = '';
    document.getElementById('kb-content').value = '';
    document.getElementById('kb-keywords').value = '';
    kbModal.showModal();
  });

  document.getElementById('close-kb-modal').addEventListener('click', () => kbModal.close());
  document.getElementById('cancel-kb-btn').addEventListener('click', () => kbModal.close());

  document.getElementById('kb-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('kb-id').value;
    const category = document.getElementById('kb-category').value.trim();
    const title = document.getElementById('kb-title').value.trim();
    const content = document.getElementById('kb-content').value.trim();
    const keywords = document.getElementById('kb-keywords').value.trim();

    try {
      await apiFetch('/api/admin/knowledge-base', {
        method: 'POST',
        body: JSON.stringify({ id, category, title, content, keywords })
      });
      kbModal.close();
      showToast('Статья успешно сохранена');
      loadKnowledgeBase();
    } catch (err) {
      showToast(err.message, true);
    }
  });

  // Экспорт заявок в CSV
  document.getElementById('export-leads-btn').addEventListener('click', exportLeadsToCsv);

  // Удаление диалога
  document.getElementById('delete-dialog-btn').addEventListener('click', async () => {
    if (!state.selectedDialogId) return;
    if (!confirm('Удалить переписку и связанные персональные данные этого диалога (GDPR)?')) return;

    try {
      await apiFetch(`/api/admin/dialogs/${state.selectedDialogId}`, { method: 'DELETE' });
      showToast('Диалог удален');
      state.selectedDialogId = null;
      document.getElementById('chat-messages-container').innerHTML = `
        <div class="empty-state">
          <span>👈</span>
          <p>Выберите диалог из списка слева</p>
        </div>
      `;
      document.getElementById('dialog-actions').hidden = true;
      document.getElementById('current-dialog-id').textContent = 'Выберите сессию';
      document.getElementById('current-dialog-meta').textContent = '—';
      loadDialogs();
    } catch (err) {
      showToast(err.message, true);
    }
  });
}

function switchTab(tabId) {
  state.activeTab = tabId;
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });
  document.querySelectorAll('.tab-pane').forEach(pane => {
    pane.classList.toggle('active', pane.id === tabId);
  });

  // Заголовки страниц
  const titles = {
    'tab-analytics': ['Аналитика и обзор работы ИИ-агента', 'Сводка показателей, статистика запросов и эффективность конверсий'],
    'tab-settings': ['Настройки OpenAI API и интеграций', 'Управление ключами доступа, моделью и CRM Bitrix24'],
    'tab-prompt': ['Системная инструкция ИИ (System Prompt)', 'Настройка логики, поведения и регламента общения агента'],
    'tab-kb': ['База знаний отеля WGB', 'Управление фактами, тарифами и правилами для консультирования гостей'],
    'tab-leads': ['Заявки клиентов', 'Управление контактами, статусами и синхронизацией с CRM'],
    'tab-dialogs': ['Диалоги и управление приватностью', 'Просмотр истории переписки и удаление персональных данных (GDPR)']
  };

  const [t, d] = titles[tabId] || ['Панель управления', ''];
  document.getElementById('page-title').textContent = t;
  document.getElementById('page-desc').textContent = d;

  loadTabData(tabId);
}

// Загрузка первичных данных
async function loadInitialData() {
  await Promise.all([
    loadConfig(),
    loadAnalytics(),
    loadKnowledgeBase(),
    loadLeads(),
    loadDialogs()
  ]);
  checkApiStatus();
}

function loadTabData(tabId) {
  if (tabId === 'tab-analytics') loadAnalytics();
  if (tabId === 'tab-settings') loadConfig();
  if (tabId === 'tab-prompt') loadConfig();
  if (tabId === 'tab-kb') loadKnowledgeBase();
  if (tabId === 'tab-leads') loadLeads();
  if (tabId === 'tab-dialogs') loadDialogs();
}

// Конфигурация
async function loadConfig() {
  try {
    const data = await apiFetch('/api/admin/config');
    state.config = data;

    // Заполняем форму настроек
    document.getElementById('cfg-api-key').placeholder = data.maskedApiKey || 'sk-proj-...';
    document.getElementById('api-key-hint').textContent = data.hasKey
      ? `Текущий ключ: ${data.maskedApiKey} (защищен на сервере)`
      : 'API-ключ еще не установлен (введите ключ и нажмите Сохранить)';
    document.getElementById('cfg-model').value = data.model || 'gpt-4o-mini';
    document.getElementById('cfg-tokens').value = data.maxTokens || 1200;
    document.getElementById('cfg-temperature').value = data.temperature ?? 0.7;
    document.getElementById('temp-val').textContent = data.temperature ?? 0.7;
    document.getElementById('cfg-active').checked = Boolean(data.isActive);
    document.getElementById('cfg-welcome').value = data.welcomeMessage || '';
    document.getElementById('cfg-prompt').value = data.systemPrompt || '';
    document.getElementById('cfg-bitrix-url').value = data.bitrixWebhookUrl || '';
    document.getElementById('cfg-retention').value = data.dataRetentionDays || 30;

    // Бейдж активности
    const dot = document.getElementById('agent-dot');
    const label = document.getElementById('agent-state-label');
    if (data.isActive) {
      dot.classList.remove('off');
      label.textContent = 'ИИ активен';
    } else {
      dot.classList.add('off');
      label.textContent = 'ИИ отключен';
    }
  } catch (err) {
    console.error('Ошибка загрузки настроек:', err);
  }
}

async function saveConfigField(partial) {
  try {
    const res = await apiFetch('/api/admin/config', {
      method: 'POST',
      body: JSON.stringify(partial)
    });
    if (res.config) {
      state.config = res.config;
    }
    return res;
  } catch (err) {
    showToast(err.message, true);
    throw err;
  }
}

async function saveOpenAiSettings(e) {
  e.preventDefault();
  const apiKey = document.getElementById('cfg-api-key').value.trim();
  const model = document.getElementById('cfg-model').value;
  const maxTokens = Number(document.getElementById('cfg-tokens').value);
  const temperature = Number(document.getElementById('cfg-temperature').value);
  const isActive = document.getElementById('cfg-active').checked;
  const welcomeMessage = document.getElementById('cfg-welcome').value.trim();

  const payload = { model, maxTokens, temperature, isActive, welcomeMessage };
  if (apiKey && !apiKey.includes('...')) {
    payload.apiKey = apiKey;
  }

  try {
    const res = await apiFetch('/api/admin/config', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    document.getElementById('cfg-api-key').value = '';
    showToast('Настройки OpenAI успешно сохранены!');
    loadConfig();
    checkApiStatus();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function testOpenAiConnection() {
  const resultEl = document.getElementById('connection-test-result');
  const btn = document.getElementById('test-connection-btn');
  btn.disabled = true;
  btn.textContent = '⏳ Проверка...';
  resultEl.hidden = false;
  resultEl.className = 'alert-box';
  resultEl.textContent = 'Отправка тестового запроса к OpenAI API...';

  const customKey = document.getElementById('cfg-api-key').value.trim();
  const customModel = document.getElementById('cfg-model').value;

  try {
    const res = await apiFetch('/api/admin/test-connection', {
      method: 'POST',
      body: JSON.stringify({ apiKey: customKey, model: customModel })
    });

    if (res.connected) {
      resultEl.className = 'alert-box success';
      resultEl.textContent = `✅ ${res.message}`;
      showToast('OpenAI подключен успешно!');
    } else {
      resultEl.className = 'alert-box error';
      resultEl.textContent = `❌ ${res.message}`;
    }
    updateApiStatusBadge(res.status, res.connected);
  } catch (err) {
    resultEl.className = 'alert-box error';
    resultEl.textContent = `❌ Ошибка: ${err.message}`;
  } finally {
    btn.disabled = false;
    btn.textContent = '⚡ Проверить подключение';
  }
}

async function checkApiStatus() {
  try {
    const res = await apiFetch('/api/admin/test-connection', {
      method: 'POST',
      body: JSON.stringify({})
    });
    updateApiStatusBadge(res.status, res.connected);
  } catch (e) {
    updateApiStatusBadge('error', false);
  }
}

function updateApiStatusBadge(status, connected) {
  const dot = document.getElementById('topbar-status-dot');
  const text = document.getElementById('topbar-status-text');
  const pill = document.getElementById('settings-status-pill');
  const pillLabel = document.getElementById('settings-status-label');

  dot.className = 'status-indicator';
  pill.className = 'status-pill';

  if (connected) {
    dot.classList.add('connected');
    text.textContent = 'OpenAI: Подключено';
    pill.classList.add('connected');
    pillLabel.textContent = 'Подключено';
  } else if (status === 'not_configured') {
    dot.classList.add('pending');
    text.textContent = 'OpenAI: Ключ не задан';
    pillLabel.textContent = 'Не настроено';
  } else {
    dot.classList.add('error');
    text.textContent = 'OpenAI: Ошибка';
    pill.classList.add('error');
    pillLabel.textContent = 'Ошибка';
  }
}

async function testCrmWebhook() {
  const url = document.getElementById('cfg-bitrix-url').value.trim();
  const resEl = document.getElementById('crm-test-result');
  resEl.hidden = false;
  resEl.className = 'alert-box';
  resEl.textContent = 'Проверка подключения к Bitrix24...';

  try {
    const res = await apiFetch('/api/admin/test-crm', {
      method: 'POST',
      body: JSON.stringify({ webhookUrl: url })
    });
    if (res.success) {
      resEl.className = 'alert-box success';
      resEl.textContent = `✅ ${res.message}`;
    } else {
      resEl.className = 'alert-box error';
      resEl.textContent = `❌ ${res.message}`;
    }
  } catch (err) {
    resEl.className = 'alert-box error';
    resEl.textContent = `❌ Ошибка: ${err.message}`;
  }
}

// Аналитика
async function loadAnalytics() {
  try {
    const data = await apiFetch('/api/admin/analytics');
    state.analytics = data;

    document.getElementById('stat-dialogs').textContent = data.totalDialogs;
    document.getElementById('stat-visitors').textContent = data.uniqueVisitorsCount;
    document.getElementById('stat-leads').textContent = data.totalLeads;
    document.getElementById('stat-conversion').textContent = data.conversionRate;
    document.getElementById('stat-handoffs').textContent = data.managerHandoffs;
    document.getElementById('stat-cost').textContent = `$${data.estimatedCostUsd.toFixed(3)}`;
    document.getElementById('stat-tokens').textContent = `${data.totalTokens.toLocaleString('ru-RU')} токенов`;

    // Таблица вопросов
    const qList = document.getElementById('questions-list');
    const qEntries = Object.entries(data.popularQuestions || {}).sort((a, b) => b[1] - a[1]);
    const totalQ = qEntries.reduce((sum, item) => sum + item[1], 0) || 1;

    if (qEntries.length === 0) {
      qList.innerHTML = `<tr><td colspan="3" class="text-center text-muted">Пока нет накопленных вопросов</td></tr>`;
    } else {
      qList.innerHTML = qEntries.map(([topic, count]) => {
        const pct = Math.round((count / totalQ) * 100);
        return `
          <tr>
            <td><strong>${escapeHtml(topic)}</strong></td>
            <td>${count}</td>
            <td>
              <div style="background:#e2e8f0; border-radius:4px; height:8px; width:100%; overflow:hidden;">
                <div style="background:var(--green); height:100%; width:${pct}%;"></div>
              </div>
              <small class="text-muted">${pct}%</small>
            </td>
          </tr>
        `;
      }).join('');
    }

    // Таблица услуг
    const sList = document.getElementById('services-list');
    const sEntries = Object.entries(data.popularServices || {}).sort((a, b) => b[1] - a[1]);
    const totalS = sEntries.reduce((sum, item) => sum + item[1], 0) || 1;

    if (sEntries.length === 0) {
      sList.innerHTML = `<tr><td colspan="3" class="text-center text-muted">Пока нет обращений к услугам</td></tr>`;
    } else {
      sList.innerHTML = sEntries.map(([svc, count]) => {
        const pct = Math.round((count / totalS) * 100);
        return `
          <tr>
            <td><strong>${escapeHtml(svc)}</strong></td>
            <td>${count}</td>
            <td>
              <div style="background:#e2e8f0; border-radius:4px; height:8px; width:100%; overflow:hidden;">
                <div style="background:var(--sage); height:100%; width:${pct}%;"></div>
              </div>
              <small class="text-muted">${pct}%</small>
            </td>
          </tr>
        `;
      }).join('');
    }

    // Свежие лиды
    renderRecentLeads(data.recentLeads || []);
  } catch (err) {
    console.error('Ошибка аналитики:', err);
  }
}

function renderRecentLeads(leads) {
  const tbody = document.getElementById('recent-leads-list');
  if (leads.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted">Заявок пока нет</td></tr>`;
    return;
  }

  tbody.innerHTML = leads.map(l => `
    <tr>
      <td><small class="text-muted">${formatDate(l.createdAt)}</small></td>
      <td><strong>${escapeHtml(l.name)}</strong></td>
      <td>
        <div>${escapeHtml(l.phone || '—')}</div>
        <small class="text-muted">${escapeHtml(l.email || '')}</small>
      </td>
      <td>${escapeHtml(l.company || '—')}</td>
      <td>
        <div>${l.dates?.start ? `${l.dates.start} — ${l.dates.end}` : 'Даты уточняются'}</div>
        <small class="text-muted">${l.guests || 1} гост. / ${l.rooms || 1} ном.</small>
      </td>
      <td><span class="badge badge-${l.status}">${formatStatus(l.status)}</span></td>
      <td><small>${formatCrmBadge(l.crmStatus)}</small></td>
    </tr>
  `).join('');
}

// База знаний
async function loadKnowledgeBase() {
  try {
    const data = await apiFetch('/api/admin/knowledge-base');
    state.knowledgeBase = data.articles;
    renderKnowledgeBase(data.articles);
  } catch (err) {
    console.error('Ошибка загрузки базы знаний:', err);
  }
}

function renderKnowledgeBase(articles) {
  const container = document.getElementById('kb-container');
  if (!articles || articles.length === 0) {
    container.innerHTML = `<div class="text-muted">База знаний пуста. Добавьте первую статью.</div>`;
    return;
  }

  container.innerHTML = articles.map(item => `
    <div class="kb-card">
      <div class="kb-card-category">${escapeHtml(item.category)}</div>
      <div class="kb-card-title">${escapeHtml(item.title)}</div>
      <div class="kb-card-content">${escapeHtml(item.content)}</div>
      <div class="kb-card-actions">
        <button class="btn btn-sm btn-outline" onclick="editKbItem('${item.id}')">✏️ Редактировать</button>
        <button class="btn btn-sm btn-danger-outline" onclick="deleteKbItem('${item.id}')">🗑️</button>
      </div>
    </div>
  `).join('');
}

window.editKbItem = function(id) {
  const item = state.knowledgeBase.find(i => i.id === id);
  if (!item) return;

  document.getElementById('kb-modal-title').textContent = 'Редактирование статьи базы знаний';
  document.getElementById('kb-id').value = item.id;
  document.getElementById('kb-category').value = item.category;
  document.getElementById('kb-title').value = item.title;
  document.getElementById('kb-content').value = item.content;
  document.getElementById('kb-keywords').value = (item.keywords || []).join(', ');

  document.getElementById('kb-modal').showModal();
};

window.deleteKbItem = async function(id) {
  if (!confirm('Удалить эту статью из базы знаний ИИ?')) return;
  try {
    await apiFetch(`/api/admin/knowledge-base/${id}`, { method: 'DELETE' });
    showToast('Статья удалена');
    loadKnowledgeBase();
  } catch (err) {
    showToast(err.message, true);
  }
};

// Заявки клиентов
async function loadLeads() {
  try {
    const data = await apiFetch('/api/admin/leads');
    state.leads = data.leads;
    document.getElementById('leads-badge').textContent = data.leads.length;
    renderAllLeads(data.leads);
  } catch (err) {
    console.error('Ошибка загрузки заявок:', err);
  }
}

function renderAllLeads(leads) {
  const tbody = document.getElementById('all-leads-list');
  if (!leads || leads.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted">Заявок пока нет</td></tr>`;
    return;
  }

  tbody.innerHTML = leads.map(l => `
    <tr>
      <td>
        <strong>#${l.id.slice(-6)}</strong>
        <div class="text-muted"><small>${formatDate(l.createdAt)}</small></div>
      </td>
      <td><strong>${escapeHtml(l.name)}</strong></td>
      <td>
        <div><a href="tel:${escapeHtml(l.phone)}">${escapeHtml(l.phone || '—')}</a></div>
        <small class="text-muted">${escapeHtml(l.email || '')}</small>
      </td>
      <td>${escapeHtml(l.company || '—')}</td>
      <td>
        <div>${l.dates?.start ? `${l.dates.start} — ${l.dates.end}` : 'Даты уточняются'}</div>
        <small class="text-muted">${l.guests || 1} гост. / ${l.rooms || 1} ном.</small>
      </td>
      <td>
        <div style="max-width:280px; font-size:12px; line-height:1.4;">
          ${l.wishes ? `<b>Пожелания:</b> ${escapeHtml(l.wishes)}<br>` : ''}
          ${l.summary ? `<span class="text-muted">${escapeHtml(l.summary)}</span>` : ''}
        </div>
      </td>
      <td>
        <select onchange="updateLeadStatus('${l.id}', this.value)" style="padding:4px 8px; font-size:12px;">
          <option value="new" ${l.status === 'new' ? 'selected' : ''}>Новая</option>
          <option value="in_progress" ${l.status === 'in_progress' ? 'selected' : ''}>В обработке</option>
          <option value="completed" ${l.status === 'completed' ? 'selected' : ''}>Завершена</option>
        </select>
      </td>
      <td>
        <div>${formatCrmBadge(l.crmStatus)}</div>
        ${l.crmStatus !== 'synced' ? `<button class="btn btn-sm btn-outline mt-16" onclick="syncLeadCrm('${l.id}')">Синхронизировать</button>` : ''}
      </td>
    </tr>
  `).join('');
}

window.updateLeadStatus = async function(id, status) {
  try {
    await apiFetch(`/api/admin/leads/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status })
    });
    showToast('Статус заявки обновлен');
  } catch (err) {
    showToast(err.message, true);
  }
};

window.syncLeadCrm = async function(id) {
  try {
    const res = await apiFetch(`/api/admin/leads/${id}/sync-crm`, { method: 'POST' });
    if (res.success) {
      showToast('Лид отправлен в Bitrix24!');
    } else {
      showToast(`Ошибка CRM: ${res.message}`, true);
    }
    loadLeads();
  } catch (err) {
    showToast(err.message, true);
  }
};

function exportLeadsToCsv() {
  if (!state.leads || state.leads.length === 0) {
    showToast('Нет заявок для экспорта', true);
    return;
  }

  const headers = ['ID', 'Дата', 'Имя', 'Телефон', 'Email', 'Компания', 'Заезд', 'Выезд', 'Гости', 'Номера', 'Пожелания', 'Статус'];
  const rows = state.leads.map(l => [
    l.id,
    l.createdAt,
    `"${(l.name || '').replace(/"/g, '""')}"`,
    `"${l.phone || ''}"`,
    `"${l.email || ''}"`,
    `"${(l.company || '').replace(/"/g, '""')}"`,
    l.dates?.start || '',
    l.dates?.end || '',
    l.guests || 1,
    l.rooms || 1,
    `"${(l.wishes || '').replace(/"/g, '""')}"`,
    l.status
  ]);

  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `WGB-leads-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// Диалоги
async function loadDialogs() {
  try {
    const data = await apiFetch('/api/admin/dialogs');
    state.dialogs = data.dialogs;
    document.getElementById('dialogs-count').textContent = `${data.dialogs.length} диалогов`;
    renderDialogsList(data.dialogs);
  } catch (err) {
    console.error('Ошибка диалогов:', err);
  }
}

function renderDialogsList(dialogs) {
  const container = document.getElementById('dialogs-sessions-list');
  if (!dialogs || dialogs.length === 0) {
    container.innerHTML = `<div class="text-muted text-center p-16">Диалогов пока нет</div>`;
    return;
  }

  container.innerHTML = dialogs.map(d => {
    const lastMsg = d.messages && d.messages.length > 0 ? d.messages[d.messages.length - 1].content : 'Пустой диалог';
    const isActive = d.id === state.selectedDialogId ? 'active' : '';
    return `
      <div class="dialog-item ${isActive}" onclick="selectDialog('${d.id}')">
        <div class="dialog-item-top">
          <span>Гость #${d.id.slice(-6)}</span>
          <span>${formatTime(d.updatedAt)}</span>
        </div>
        <div class="dialog-item-preview">${escapeHtml(lastMsg)}</div>
      </div>
    `;
  }).join('');
}

window.selectDialog = function(id) {
  state.selectedDialogId = id;
  const dialog = state.dialogs.find(d => d.id === id);
  if (!dialog) return;

  // Подсветка в списке
  document.querySelectorAll('.dialog-item').forEach(el => el.classList.remove('active'));
  event?.currentTarget?.classList.add('active');

  document.getElementById('current-dialog-id').textContent = `Диалог #${dialog.id.slice(-8)}`;
  document.getElementById('current-dialog-meta').textContent = `Начат: ${formatDate(dialog.createdAt)} · Сообщений: ${dialog.messages.length}`;
  document.getElementById('dialog-actions').hidden = false;

  const msgContainer = document.getElementById('chat-messages-container');
  if (!dialog.messages || dialog.messages.length === 0) {
    msgContainer.innerHTML = `<div class="empty-state"><p>В этой сессии еще нет сообщений</p></div>`;
    return;
  }

  msgContainer.innerHTML = dialog.messages.map(m => `
    <div class="chat-bubble ${m.role}">
      <div class="chat-bubble-content">${escapeHtml(m.content).replace(/\n/g, '<br>')}</div>
      <div class="chat-bubble-meta">${m.role === 'user' ? 'Гость' : 'ИИ-консультант'} · ${formatTime(m.timestamp)}</div>
    </div>
  `).join('');

  msgContainer.scrollTop = msgContainer.scrollHeight;
};

// Хелперы форматирования
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function formatStatus(status) {
  const map = { new: 'Новая', in_progress: 'В работе', completed: 'Завершена' };
  return map[status] || status;
}

function formatCrmBadge(status) {
  if (status === 'synced') return '<span class="badge badge-completed">✅ Bitrix24</span>';
  if (status === 'pending') return '<span class="badge badge-in_progress">⏳ Ожидает</span>';
  if (status === 'error') return '<span class="badge badge-new" style="background:#fee2e2; color:#b91c1c;">⚠️ Ошибка</span>';
  return '<span class="text-muted">Не настроено</span>';
}
