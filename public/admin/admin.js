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

  // База знаний: модальное окно создания/редактирования
  const kbModal = document.getElementById('kb-modal');
  const kbHistoryModal = document.getElementById('kb-history-modal');

  document.getElementById('new-kb-btn')?.addEventListener('click', () => {
    document.getElementById('kb-modal-title').textContent = 'Добавление статьи базы знаний';
    document.getElementById('kb-id').value = '';
    document.getElementById('kb-category').value = '';
    document.getElementById('kb-lang').value = 'ru';
    document.getElementById('kb-title').value = '';
    document.getElementById('kb-content').value = '';
    document.getElementById('kb-keywords').value = '';
    document.getElementById('kb-status').value = 'published';
    kbModal.showModal();
  });

  document.getElementById('close-kb-modal')?.addEventListener('click', () => kbModal.close());
  document.getElementById('cancel-kb-btn')?.addEventListener('click', () => kbModal.close());

  // Закрытие окна истории
  document.getElementById('close-kb-history-modal')?.addEventListener('click', () => kbHistoryModal.close());
  document.getElementById('close-kb-history-btn')?.addEventListener('click', () => kbHistoryModal.close());

  // Фильтры базы знаний
  document.getElementById('kb-filter-status')?.addEventListener('change', () => renderFilteredKnowledgeBase());
  document.getElementById('kb-filter-lang')?.addEventListener('change', () => renderFilteredKnowledgeBase());

  // Кнопка синхронизации с OpenAI
  document.getElementById('kb-sync-btn')?.addEventListener('click', syncKnowledgeBaseWithOpenAI);

  // Кнопка отката Vector Store
  document.getElementById('kb-rollback-btn')?.addEventListener('click', rollbackVectorStore);

  // Сохранить как черновик (отдельная кнопка)
  document.getElementById('save-kb-draft-btn')?.addEventListener('click', async () => {
    document.getElementById('kb-status').value = 'draft';
    await saveKbArticleFromForm('draft');
  });

  // Отправка формы (Опубликовать)
  document.getElementById('kb-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveKbArticleFromForm(document.getElementById('kb-status').value || 'published');
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

// База знаний — Управление статьями и OpenAI Vector Store
async function loadKnowledgeBase() {
  try {
    const [articlesData, syncData] = await Promise.all([
      apiFetch('/api/admin/articles').catch(() => apiFetch('/api/admin/knowledge-base')),
      apiFetch('/api/admin/sync-status').catch(() => null)
    ]);

    state.knowledgeBase = articlesData.articles || [];
    renderSyncStatus(syncData);
    renderFilteredKnowledgeBase();
  } catch (err) {
    console.error('Ошибка загрузки базы знаний:', err);
  }
}

function renderSyncStatus(syncData) {
  const badge = document.getElementById('kb-sync-status-badge');
  const vsIdEl = document.getElementById('kb-active-vs-id');
  const lastSyncEl = document.getElementById('kb-last-sync-time');
  const errorBox = document.getElementById('kb-sync-error');
  const rollbackBtn = document.getElementById('kb-rollback-btn');

  if (!badge) return;

  const currentVsId = syncData?.activeVectorStoreId || state.config?.vectorStoreId || '—';
  vsIdEl.textContent = currentVsId;

  if (syncData?.lastSyncAt) {
    lastSyncEl.textContent = formatDate(syncData.lastSyncAt);
  } else {
    lastSyncEl.textContent = 'Ещё не выполнялась';
  }

  if (syncData?.status === 'success') {
    badge.className = 'badge badge-completed';
    badge.textContent = `✅ Синхронизировано (${syncData.indexedFilesCount || 0} документов)`;
  } else if (syncData?.status === 'in_progress') {
    badge.className = 'badge badge-in_progress';
    badge.textContent = '⏳ Индексация в процессе...';
  } else if (syncData?.status === 'error') {
    badge.className = 'badge badge-new';
    badge.style.background = '#fee2e2';
    badge.style.color = '#b91c1c';
    badge.textContent = '⚠️ Ошибка синхронизации';
  } else {
    badge.className = 'badge';
    badge.style.background = '#e2e8f0';
    badge.style.color = '#475569';
    badge.textContent = 'Готово к синхронизации';
  }

  if (syncData?.lastError) {
    errorBox.style.display = 'block';
    errorBox.textContent = `Ошибка синхронизации: ${syncData.lastError}`;
  } else {
    errorBox.style.display = 'none';
  }

  if (syncData?.previousVectorStoreId) {
    rollbackBtn.style.display = 'inline-block';
    rollbackBtn.title = `Откатить к предыдущему Vector Store: ${syncData.previousVectorStoreId}`;
  } else {
    rollbackBtn.style.display = 'none';
  }
}

function renderFilteredKnowledgeBase() {
  const statusFilter = document.getElementById('kb-filter-status')?.value || 'all';
  const langFilter = document.getElementById('kb-filter-lang')?.value || 'all';

  let filtered = state.knowledgeBase;
  if (statusFilter !== 'all') {
    filtered = filtered.filter(a => a.status === statusFilter);
  }
  if (langFilter !== 'all') {
    filtered = filtered.filter(a => (a.lang || 'ru') === langFilter);
  }

  renderKnowledgeBase(filtered);
}

function renderKnowledgeBase(articles) {
  const container = document.getElementById('kb-container');
  if (!articles || articles.length === 0) {
    container.innerHTML = `<div class="text-muted text-center" style="grid-column: 1/-1; padding: 32px 0;">Статей по выбранному фильтру не найдено. Нажмите «+ Добавить статью».</div>`;
    return;
  }

  container.innerHTML = articles.map(item => {
    const isDraft = item.status === 'draft';
    const langBadge = (item.lang || 'ru').toUpperCase();
    const versionBadge = `v${item.version || 1}`;
    const historyCount = Array.isArray(item.history) ? item.history.length : 0;

    return `
      <div class="kb-card" style="${isDraft ? 'border-style: dashed; background: #fdfefe;' : ''}">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <div class="kb-card-category" style="margin: 0;">${escapeHtml(item.category)}</div>
          <div style="display: flex; gap: 6px; align-items: center;">
            <span class="badge" style="background:#e0f2fe; color:#0369a1; font-size:10px; padding:2px 6px;">${langBadge}</span>
            <span class="badge" style="background:#f1f5f9; color:#475569; font-size:10px; padding:2px 6px;">${versionBadge}</span>
            <span class="badge ${isDraft ? 'badge-new' : 'badge-completed'}" style="${isDraft ? 'background:#fef3c7; color:#92400e;' : ''}">
              ${isDraft ? '📝 Черновик' : '✅ Опубликовано'}
            </span>
          </div>
        </div>
        <div class="kb-card-title">${escapeHtml(item.title)}</div>
        <div class="kb-card-content">${escapeHtml(item.content)}</div>
        <div style="font-size: 11px; color: var(--muted); margin-bottom: 12px;">
          Обновлено: ${formatDate(item.updatedAt)}
        </div>
        <div class="kb-card-actions" style="flex-wrap: wrap; justify-content: space-between;">
          <div style="display: flex; gap: 6px;">
            <button class="btn btn-sm btn-outline" onclick="editKbItem('${item.id}')" title="Редактировать статью">✏️</button>
            ${isDraft
              ? `<button class="btn btn-sm btn-primary" onclick="publishKbItem('${item.id}')" title="Опубликовать статью">📢 Опубликовать</button>`
              : `<button class="btn btn-sm btn-secondary" onclick="unpublishKbItem('${item.id}')" title="Перевести в черновик">📝 В черновик</button>`
            }
            <button class="btn btn-sm btn-outline" onclick="viewKbHistory('${item.id}')" title="История версий">
              🕒 История ${historyCount > 0 ? `(${historyCount})` : ''}
            </button>
          </div>
          <button class="btn btn-sm btn-danger-outline" onclick="deleteKbItem('${item.id}')" title="Удалить статью">🗑️</button>
        </div>
      </div>
    `;
  }).join('');
}

async function saveKbArticleFromForm(statusToSave = 'published') {
  const id = document.getElementById('kb-id').value;
  const category = document.getElementById('kb-category').value.trim();
  const lang = document.getElementById('kb-lang').value;
  const title = document.getElementById('kb-title').value.trim();
  const content = document.getElementById('kb-content').value.trim();
  const keywords = document.getElementById('kb-keywords').value.trim();

  if (!title || !content) {
    showToast('Заголовок и содержимое статьи обязательны', true);
    return;
  }

  try {
    await apiFetch('/api/admin/articles', {
      method: 'POST',
      body: JSON.stringify({
        id: id || undefined,
        category: category || 'Общее',
        lang,
        title,
        content,
        keywords,
        status: statusToSave
      })
    });
    document.getElementById('kb-modal').close();
    showToast(statusToSave === 'published' ? 'Статья успешно опубликована!' : 'Черновик статьи сохранён!');
    loadKnowledgeBase();
  } catch (err) {
    showToast(err.message, true);
  }
}

window.editKbItem = function(id) {
  const item = state.knowledgeBase.find(i => i.id === id);
  if (!item) return;

  document.getElementById('kb-modal-title').textContent = 'Редактирование статьи базы знаний';
  document.getElementById('kb-id').value = item.id;
  document.getElementById('kb-category').value = item.category;
  document.getElementById('kb-lang').value = item.lang || 'ru';
  document.getElementById('kb-title').value = item.title;
  document.getElementById('kb-content').value = item.content;
  document.getElementById('kb-keywords').value = (item.keywords || []).join(', ');
  document.getElementById('kb-status').value = item.status || 'published';

  document.getElementById('kb-modal').showModal();
};

window.publishKbItem = async function(id) {
  try {
    await apiFetch(`/api/admin/articles/${id}/publish`, { method: 'POST' });
    showToast('Статья опубликована! Теперь она доступна ИИ.');
    loadKnowledgeBase();
  } catch (err) {
    showToast(err.message, true);
  }
};

window.unpublishKbItem = async function(id) {
  try {
    await apiFetch(`/api/admin/articles/${id}/unpublish`, { method: 'POST' });
    showToast('Статья снята с публикации и переведена в черновик.');
    loadKnowledgeBase();
  } catch (err) {
    showToast(err.message, true);
  }
};

window.viewKbHistory = async function(id) {
  const modal = document.getElementById('kb-history-modal');
  const titleEl = document.getElementById('kb-history-modal-title');
  const subEl = document.getElementById('kb-history-modal-subtitle');
  const listEl = document.getElementById('kb-history-list');

  try {
    const data = await apiFetch(`/api/admin/articles/${id}`);
    const article = data.article;
    if (!article) return;

    titleEl.textContent = `История версий: «${article.title}»`;
    subEl.textContent = `Текущая версия: v${article.version || 1} · Статус: ${article.status === 'published' ? 'Опубликовано' : 'Черновик'}`;

    const history = article.history || [];
    if (history.length === 0) {
      listEl.innerHTML = `<div class="text-muted text-center p-16">У этой статьи пока нет предыдущих версий. При каждом редактировании сохраняется снимок.</div>`;
    } else {
      listEl.innerHTML = history.map(h => `
        <div style="border: 1px solid var(--line); border-radius: 6px; padding: 12px; background: #fafbf9;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <div>
              <span class="badge" style="background:#e0f2fe; color:#0369a1; font-weight:600;">Версия ${h.version}</span>
              <span class="badge" style="font-size:11px;">${h.status === 'published' ? 'Опубликована' : 'Черновик'}</span>
            </div>
            <small class="text-muted">${formatDate(h.updatedAt)}</small>
          </div>
          <div style="font-weight: 600; font-size: 13px; margin-bottom: 4px;">${escapeHtml(h.title)}</div>
          <div style="font-size: 12px; color: var(--muted); margin-bottom: 8px; line-height: 1.4;">
            ${escapeHtml(h.content.slice(0, 160))}${h.content.length > 160 ? '...' : ''}
          </div>
          <button class="btn btn-sm btn-outline" onclick="restoreKbVersion('${article.id}', ${h.version})">
            ↩️ Восстановить версию ${h.version}
          </button>
        </div>
      `).join('');
    }

    modal.showModal();
  } catch (err) {
    showToast(err.message, true);
  }
};

window.restoreKbVersion = async function(id, version) {
  if (!confirm(`Восстановить версию ${version}? Текущее состояние сохранится в историю.`)) return;

  try {
    await apiFetch(`/api/admin/articles/${id}/restore`, {
      method: 'POST',
      body: JSON.stringify({ version })
    });
    document.getElementById('kb-history-modal').close();
    showToast(`Версия ${version} успешно восстановлена!`);
    loadKnowledgeBase();
  } catch (err) {
    showToast(err.message, true);
  }
};

window.deleteKbItem = async function(id) {
  if (!confirm('Удалить эту статью из базы знаний?')) return;
  try {
    await apiFetch(`/api/admin/articles/${id}`, { method: 'DELETE' });
    showToast('Статья удалена');
    loadKnowledgeBase();
  } catch (err) {
    showToast(err.message, true);
  }
};

async function syncKnowledgeBaseWithOpenAI() {
  const syncBtn = document.getElementById('kb-sync-btn');
  if (!confirm('Запустить синхронизацию опубликованных статей с OpenAI Vector Store?\n\nБудет создан новый Vector Store, загружены актуальные опубликованные статьи, выполнен контрольный поиск и только после успешной проверки активировано новое хранилище.')) {
    return;
  }

  syncBtn.disabled = true;
  const originalText = syncBtn.textContent;
  syncBtn.textContent = '⏳ Синхронизация и проверка...';
  showToast('Синхронизация с OpenAI начата. Пожалуйста, подождите...');

  try {
    const res = await apiFetch('/api/admin/vector-store/sync', { method: 'POST' });
    if (res.success) {
      showToast(`✅ Успешно синхронизировано! Индексировано файлов: ${res.indexedFilesCount}. Active VS: ${res.vectorStoreId}`);
    } else {
      showToast(`Ошибка синхронизации: ${res.error || res.message}`, true);
    }
    loadKnowledgeBase();
    loadConfig();
  } catch (err) {
    showToast(`Ошибка: ${err.message}`, true);
    loadKnowledgeBase();
  } finally {
    syncBtn.disabled = false;
    syncBtn.textContent = originalText;
  }
}

async function rollbackVectorStore() {
  if (!confirm('Вы действительно хотите откатить Vector Store к предыдущей проверенной версии?')) {
    return;
  }

  try {
    const res = await apiFetch('/api/admin/vector-store/rollback', { method: 'POST' });
    if (res.success) {
      showToast(`Откат выполнен успешно! Активный Vector Store: ${res.activeVectorStoreId}`);
      loadKnowledgeBase();
      loadConfig();
    } else {
      showToast(`Ошибка отката: ${res.error}`, true);
    }
  } catch (err) {
    showToast(`Ошибка: ${err.message}`, true);
  }
}

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
