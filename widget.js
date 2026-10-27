/**
 * WGB Hotel & Restaurant — Виртуальный ИИ-консультант
 * Встраиваемый плавающий виджет чата
 */
(function() {
  'use strict';

  const scriptBase = new URL('.', document.currentScript.src);
  const configuredBase = (window.WGB_ASSISTANT_CONFIG?.apiBase || '').replace(/\/$/, '');
  const staticDemo = location.hostname.endsWith('.github.io') && !configuredBase;
  const apiBase = configuredBase || '/api';
  let referenceDraft = {};
  async function requestJson(path, options = {}) {
    const response = await fetch(apiBase + path, {...options, signal: AbortSignal.timeout(20000)});
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || `Сервер ассистента недоступен (${response.status}).`);
    }
    return response.json();
  }
  async function referenceReply(text) {
    const response = await fetch(new URL('assistant-knowledge.json', scriptBase), {cache: 'no-store'});
    if (!response.ok) throw new Error('Публичная база знаний недоступна.');
    const context = await response.json();
    const result = window.WgbAssistantPolicy.fallback(text, context, referenceDraft);
    referenceDraft = result.bookingDraft;
    // The reference mode never collects or transmits contacts.
    if (result.actionType === 'request_contacts') {
      delete result.actionType;
      result.reply = 'Сейчас доступен справочный режим: отправка обращений менеджеру не подключена. Контакты не собираются.';
    }
    return result;
  }

  // Инициализация уникального идентификатора сессии и посетителя
  let sessionId = sessionStorage.getItem('wgb_chat_session_id');
  if (!sessionId) {
    sessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    sessionStorage.setItem('wgb_chat_session_id', sessionId);
  }

  let visitorId = localStorage.getItem('wgb_visitor_id');
  if (!visitorId) {
    visitorId = 'vis_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    localStorage.setItem('wgb_visitor_id', visitorId);
  }

  // Состояние виджета
  const widgetState = {
    isOpen: false,
    isActive: true,
    welcomeMessage: staticDemo ? 'Здравствуйте! Я справочный помощник WGB. На этой версии сайта отвечаю по демонстрационной базе без подключения ИИ. Бронирование и передача заявок не подключены.' : 'Здравствуйте! Я ИИ-консультант WGB. Помогу с информацией об отеле и предварительным расчётом.',
    isWaiting: false,
    messagesCount: 0
  };

  // Элементы интерфейса
  let launcherBtn, chatWidget, chatBody, chatInput, sendBtn;

  // Базовые быстрые действия
  const DEFAULT_QUICK_ACTIONS = [
    'Забронировать номер',
    'Рассчитать групповое проживание',
    'Узнать об услугах отеля',
    'Организовать деловую поездку',
    'Связаться с менеджером'
  ];

  // Создание DOM элементов виджета
  function initWidgetDOM() {
    // 1. Плавающая кнопка (Launcher)
    launcherBtn = document.createElement('button');
    launcherBtn.className = 'wgb-ai-launcher';
    launcherBtn.setAttribute('aria-label', 'Открыть чат с виртуальным консультантом WGB');
    launcherBtn.setAttribute('title', 'Виртуальный консультант WGB');
    launcherBtn.innerHTML = `
      <span class="wgb-ai-pulse" aria-hidden="true"></span>
      <svg class="wgb-chat-icon" viewBox="0 0 24 24">
        <path d="M12 2C6.477 2 2 6.477 2 12c0 1.821.487 3.53 1.338 5L2 22l5.223-1.282A9.954 9.954 0 0 0 12 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm1 14h-2v-2h2v2zm0-4h-2c0-3.25 3-3 3-5 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 2.5-3 2.75-3 5z"/>
      </svg>
      <svg class="wgb-close-icon" viewBox="0 0 24 24">
        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
      </svg>
    `;

    // 2. Окно чата (Widget container)
    chatWidget = document.createElement('div');
    chatWidget.className = 'wgb-chat-widget';
    chatWidget.setAttribute('role', 'dialog');
    chatWidget.setAttribute('aria-label', 'Чат с виртуальным консультантом');
    chatWidget.innerHTML = `
      <div class="wgb-chat-header">
        <div class="wgb-chat-header-info">
          <div class="wgb-chat-avatar">
            <span>✨</span>
            <span class="wgb-chat-avatar-dot" aria-hidden="true"></span>
          </div>
          <div class="wgb-chat-header-text">
            <h3>Виртуальный консультант WGB</h3>
            <p id="wgb-agent-mode">Проверяем подключение…</p>
          </div>
        </div>
        <div class="wgb-chat-header-actions">
          <button class="wgb-header-btn" id="wgb-call-manager-btn" title="Связаться с менеджером" aria-label="Связаться с менеджером">📞</button>
          <button class="wgb-header-btn" id="wgb-minimize-btn" title="Свернуть чат" aria-label="Свернуть чат">_</button>
          <button class="wgb-header-btn" id="wgb-close-btn" title="Закрыть чат" aria-label="Закрыть чат">×</button>
        </div>
      </div>

      <div class="wgb-chat-body" id="wgb-chat-messages">
        <!-- Сообщения будут рендериться здесь -->
      </div>

      <div class="wgb-chat-footer">
        <div class="wgb-chat-input-row">
          <textarea maxlength="8000"
            class="wgb-chat-textarea"
            id="wgb-chat-input"
            rows="1"
            placeholder="Задайте вопрос об отеле..."
            aria-label="Сообщение консультанту"
          ></textarea>
          <button class="wgb-chat-send-btn" id="wgb-chat-send" aria-label="Отправить сообщение">
            <svg viewBox="0 0 24 24">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
            </svg>
          </button>
        </div>
        <div class="wgb-chat-disclaimer">
          Не указывайте платёжные и паспортные данные в чате
        </div>
      </div>
    `;

    document.body.appendChild(launcherBtn);
    document.body.appendChild(chatWidget);

    chatBody = chatWidget.querySelector('#wgb-chat-messages');
    chatInput = chatWidget.querySelector('#wgb-chat-input');
    sendBtn = chatWidget.querySelector('#wgb-chat-send');

    setupEventHandlers();
  }

  // Настройка слушателей событий
  function setupEventHandlers() {
    launcherBtn.addEventListener('click', toggleChat);

    chatWidget.querySelector('#wgb-close-btn').addEventListener('click', () => setChatOpen(false));
    chatWidget.querySelector('#wgb-minimize-btn').addEventListener('click', () => setChatOpen(false));

    chatWidget.querySelector('#wgb-call-manager-btn').addEventListener('click', () => {
      if (staticDemo) { appendMessageUI('bot', 'На этой версии сайта отправка заявок не подключена. Контакты не собираются.'); return; }
      showLeadFormCard('Связь с менеджером отеля');
    });

    sendBtn.addEventListener('click', handleSendMessage);

    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendMessage();
      }
    });

    chatInput.addEventListener('input', () => {
      chatInput.style.height = 'auto';
      chatInput.style.height = Math.min(chatInput.scrollHeight, 100) + 'px';
    });
  }

  function toggleChat() {
    setChatOpen(!widgetState.isOpen);
  }

  function setChatOpen(isOpen) {
    widgetState.isOpen = isOpen;
    launcherBtn.classList.toggle('active', isOpen);
    chatWidget.classList.toggle('open', isOpen);

    if (isOpen) {
      if (widgetState.messagesCount === 0) {
        loadHistoryOrWelcome();
      }
      setTimeout(() => chatInput.focus(), 250);
    }
  }

  // Загрузка сохраненной истории или приветствия
  async function loadHistoryOrWelcome() {
    try {
      if (staticDemo) throw new Error('Reference mode');
      const data = await requestJson(`/chat/history/${sessionId}`);

      if (data.messages && data.messages.length > 0) {
        data.messages.forEach(m => {
          appendMessageUI(m.role === 'user' ? 'user' : 'bot', m.content, m.timestamp, m.metadata);
        });
      } else {
        // Приветственное сообщение
        appendMessageUI('bot', widgetState.welcomeMessage, new Date(), {
          quickActions: DEFAULT_QUICK_ACTIONS
        });
      }
    } catch (e) {
      appendMessageUI('bot', widgetState.welcomeMessage, new Date(), {
        quickActions: DEFAULT_QUICK_ACTIONS
      });
    }
  }

  // Добавление сообщения в интерфейс
  function appendMessageUI(role, text, timestamp = new Date(), metadata = null) {
    widgetState.messagesCount++;

    const msgEl = document.createElement('div');
    msgEl.className = `wgb-chat-msg ${role}`;

    const bubbleEl = document.createElement('div');
    bubbleEl.className = 'wgb-msg-bubble';
    bubbleEl.innerHTML = formatMessageContent(text);

    msgEl.appendChild(bubbleEl);

    // Интерактивная карточка расчета проживания
    if (metadata && metadata.calculation) {
      const calcCard = createCalculationCard(metadata.calculation);
      msgEl.appendChild(calcCard);
    }

    // Форма сбора лида
    if (metadata && (metadata.actionType === 'request_contacts' || metadata.needContacts)) {
      const leadCard = createLeadFormCard('Оставить контакты для менеджера');
      msgEl.appendChild(leadCard);
    }

    // Быстрые кнопки (Chips)
    if (metadata && Array.isArray(metadata.suggestedActions) && metadata.suggestedActions.length > 0) {
      const chipsEl = createQuickActions(metadata.suggestedActions);
      msgEl.appendChild(chipsEl);
    } else if (metadata && Array.isArray(metadata.quickActions)) {
      const chipsEl = createQuickActions(metadata.quickActions);
      msgEl.appendChild(chipsEl);
    }

    // Время отправки
    const timeEl = document.createElement('div');
    timeEl.className = 'wgb-msg-time';
    const d = new Date(timestamp);
    timeEl.textContent = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    msgEl.appendChild(timeEl);

    chatBody.appendChild(msgEl);
    scrollToBottom();
  }

  // Форматирование текста (markdown bold, списки, переносы)
  function formatMessageContent(rawText) {
    if (!rawText) return '';
    return rawText
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/\n/g, '<br>');
  }

  // Создание быстрых кнопок (Chips)
  function createQuickActions(actions) {
    const wrap = document.createElement('div');
    wrap.className = 'wgb-quick-actions';

    actions.forEach(actionText => {
      const btn = document.createElement('button');
      btn.className = 'wgb-quick-chip';
      btn.type = 'button';
      btn.textContent = actionText;
      btn.addEventListener('click', () => {
        if (actionText === 'Связаться с менеджером') {
          showLeadFormCard('Связь со специалистом отеля');
        } else {
          sendMessage(actionText);
        }
      });
      wrap.appendChild(btn);
    });

    return wrap;
  }

  // Создание карточки расчета
  function createCalculationCard(calc) {
    const card = document.createElement('div');
    card.className = 'wgb-calc-card';

    const roomTotalFormatted = (calc.roomCost || 0).toLocaleString('ru-RU') + ' ₸';
    const mealTotalFormatted = (calc.mealCost || 0).toLocaleString('ru-RU') + ' ₸';
    const totalFormatted = (calc.total || 0).toLocaleString('ru-RU') + ' ₸';
    const perPersonFormatted = (calc.perPerson || 0).toLocaleString('ru-RU') + ' ₸';

    card.innerHTML = `
      <div class="wgb-calc-title">📊 Предварительный расчёт WGB</div>
      <div class="wgb-calc-row"><span>Даты:</span> <strong>${calc.start} — ${calc.end} (${calc.nights} ноч.)</strong></div>
      <div class="wgb-calc-row"><span>Гостей / Номеров:</span> <strong>${calc.guests} гостей / ${calc.rooms} ном.</strong></div>
      <div class="wgb-calc-row"><span>Проживание (${calc.roomRate?.toLocaleString('ru-RU')} ₸/сут):</span> <strong>${roomTotalFormatted}</strong></div>
      <div class="wgb-calc-row"><span>Питание (${calc.mealLabel || 'Без питания'}):</span> <strong>${mealTotalFormatted}</strong></div>
      <div class="wgb-calc-total">
        <span>ИТОГО:</span>
        <span>${totalFormatted} <small>(${perPersonFormatted}/чел)</small></span>
      </div>
      <div class="wgb-calc-action">
        <button type="button" class="wgb-calc-btn outline" id="wgb-apply-calc-btn">В калькулятор сайта</button>
        <button type="button" class="wgb-calc-btn" id="wgb-book-calc-btn">Запросить условия</button>
      </div>
    `;

    // Применить параметры к калькулятору сайта
    card.querySelector('#wgb-apply-calc-btn')?.addEventListener('click', () => {
      try {
        const arrInput = document.querySelector('#arrival');
        const depInput = document.querySelector('#departure');
        const guestsInput = document.querySelector('#guests');
        const occInput = document.querySelector('#occupancy');
        const mealInput = document.querySelector('#meal');

        if (arrInput && calc.start) arrInput.value = calc.start;
        if (depInput && calc.end) depInput.value = calc.end;
        if (guestsInput && calc.guests) guestsInput.value = calc.guests;
        if (occInput && calc.occupancy) occInput.value = calc.occupancy;
        if (mealInput && calc.mealKey) mealInput.value = calc.mealKey;

        // Вызов события обновления на сайте
        document.querySelector('#group-form')?.dispatchEvent(new Event('input', { bubbles: true }));

        // Скролл к блоку расчета
        const estimateSection = document.querySelector('#estimate');
        if (estimateSection) {
          estimateSection.scrollIntoView({ behavior: 'smooth' });
        }

        appendMessageUI('bot', 'Параметры поездки перенесены в интерактивный калькулятор на странице! Вы можете скачать подробный план в Excel прямо из формы сайта.');
      } catch (e) {
        console.error('Ошибка заполнения формы:', e);
      }
    });

    // Оформить бронь
    card.querySelector('#wgb-book-calc-btn')?.addEventListener('click', () => {
      showLeadFormCard(`Бронирование группы (${calc.guests} гостей, ${calc.start} - ${calc.end})`, calc);
    });

    return card;
  }

  // Создание формы контакта с менеджером
  function createLeadFormCard(title = 'Связаться с менеджером', calcData = null) {
    const card = document.createElement('div');
    card.className = 'wgb-lead-form-card';
    card.innerHTML = `
      <h4>${title}</h4>
      <input type="text" id="wgb-lead-name" placeholder="Ваше имя *" required>
      <input type="tel" id="wgb-lead-phone" placeholder="Телефон для связи *" required>
      <input type="email" id="wgb-lead-email" placeholder="Email (необязательно)">
      <input type="text" id="wgb-lead-company" placeholder="Компания (если корпоративная поездка)">
      <textarea id="wgb-lead-wishes" rows="2" placeholder="Пожелания, ранний заезд, документы..."></textarea>
      <label style="font-size:12px;display:flex;gap:8px"><input type="checkbox" class="wgb-lead-consent" style="width:auto">Согласен на обработку указанных контактов и передачу менеджеру WGB для ответа на обращение.</label>
      <button type="button" class="wgb-lead-submit-btn" id="wgb-submit-lead-btn">Отправить заявку менеджеру</button>
    `;

    card.querySelector('#wgb-submit-lead-btn').addEventListener('click', async () => {
      const name = card.querySelector('#wgb-lead-name').value.trim();
      const phone = card.querySelector('#wgb-lead-phone').value.trim();
      const email = card.querySelector('#wgb-lead-email').value.trim();
      const company = card.querySelector('#wgb-lead-company').value.trim();
      const wishes = card.querySelector('#wgb-lead-wishes').value.trim();

      if (!card.querySelector('.wgb-lead-consent').checked) { alert('Подтвердите согласие на обработку и передачу контактов.'); return; }
      if (!name || !phone) {
        alert('Пожалуйста, укажите имя и номер телефона');
        return;
      }

      const submitBtn = card.querySelector('#wgb-submit-lead-btn');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Отправка...';

      try {
        const payload = {
          sessionId,
          consentConfirmed: true,
          name,
          phone,
          email,
          company,
          wishes: wishes + (calcData ? ` [Расчет: ${calcData.start} - ${calcData.end}, ${calcData.guests} гостей, сумма: ${calcData.total} ₸]` : ''),
          dates: calcData ? { start: calcData.start, end: calcData.end } : null,
          guests: calcData?.guests || 1,
          rooms: calcData?.rooms || 1,
          summary: `Заявка от ${name} (${phone}), ${calcData ? 'с расчетом поездки' : 'обращение к менеджеру'}`
        };

        const data = await requestJson('/lead', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (data.success) {
          card.innerHTML = `
            <div style="color:var(--wgb-green); font-weight:600; text-align:center; padding:10px 0;">
              ✅ Заявка №${data.lead.id.slice(-6)} принята!<br>
              <small style="font-weight:400; color:var(--wgb-muted);">Менеджер отеля WGB свяжется с вами по указанным контактам.</small>
            </div>
          `;
        } else {
          alert('Не удалось отправить заявку: ' + (data.error || 'попробуйте снова'));
          submitBtn.disabled = false;
          submitBtn.textContent = 'Отправить заявку менеджеру';
        }
      } catch (err) {
        alert('Ошибка связи с сервером');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Отправить заявку менеджеру';
      }
    });

    return card;
  }

  function showLeadFormCard(title, calcData = null) {
    if (staticDemo) { appendMessageUI('bot', 'Отправка заявок в справочном режиме не подключена. Контакты не собираются.'); return; }
    const card = createLeadFormCard(title, calcData);
    const wrap = document.createElement('div');
    wrap.className = 'wgb-chat-msg bot';
    wrap.appendChild(card);
    chatBody.appendChild(wrap);
    scrollToBottom();
  }

  // Индикатор набора текста
  let typingEl = null;

  function showTypingIndicator() {
    if (typingEl) return;
    typingEl = document.createElement('div');
    typingEl.className = 'wgb-typing-indicator';
    typingEl.innerHTML = '<span></span><span></span><span></span>';
    chatBody.appendChild(typingEl);
    scrollToBottom();
  }

  function hideTypingIndicator() {
    if (typingEl) {
      typingEl.remove();
      typingEl = null;
    }
  }

  function scrollToBottom() {
    chatBody.scrollTop = chatBody.scrollHeight;
  }

  // Отправка сообщения
  async function handleSendMessage() {
    const text = chatInput.value.trim();
    if (!text || widgetState.isWaiting) return;
    chatInput.value = '';
    chatInput.style.height = 'auto';
    sendMessage(text);
  }

  async function sendMessage(text) {
    if (widgetState.isWaiting) return;
    try { window.WgbAssistantPolicy.validateMessage(text); }
    catch(error) { appendMessageUI('bot', error.message); return; }

    appendMessageUI('user', text);
    widgetState.isWaiting = true;
    sendBtn.disabled = true;
    showTypingIndicator();

    try {
      const data = staticDemo ? await referenceReply(text) : await requestJson('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          visitorId,
          message: text
        })
      });

      hideTypingIndicator();
      if (!staticDemo && data.mode === 'fallback') {
        chatWidget.querySelector('#wgb-agent-mode').textContent = 'Справочный режим · ИИ недоступен';
      }

      if (data.reply) {
        appendMessageUI('bot', data.reply, new Date(), {
          calculation: data.calculation,
          suggestedActions: data.suggestedActions,
          actionType: data.actionType
        });
      } else {
        appendMessageUI('bot', data.error || 'Произошла ошибка при обработке запроса. Пожалуйста, повторите попытку.', new Date(), {
          quickActions: ['Связаться с менеджером']
        });
      }
    } catch (err) {
      hideTypingIndicator();
      appendMessageUI('bot', 'Сервис ассистента сейчас недоступен. Сообщение не обработано. ' + (err.name === 'TimeoutError' ? 'Сервер не ответил вовремя.' : err.message), new Date(), {
        quickActions: ['Связаться с менеджером']
      });
    } finally {
      widgetState.isWaiting = false;
      sendBtn.disabled = false;
      chatInput.focus();
    }
  }

  // Проверка статуса агента на сервере
  async function checkAgentStatus() {
    try {
      if (staticDemo) {
        chatWidget.querySelector('#wgb-agent-mode').textContent = 'Справочный режим · демонстрационные данные';
        return;
      }
      const data = await requestJson('/agent/status');
      chatWidget.querySelector('#wgb-agent-mode').textContent = data.hasApiKey ? 'ИИ-консультант' : 'Справочный режим · ИИ не подключён';
      if (data.welcomeMessage) {
        widgetState.welcomeMessage = data.welcomeMessage;
      }
      if (data.isActive === false) {
        widgetState.isActive = false;
        launcherBtn.style.display = 'none';
      }
    } catch (e) {
      chatWidget.querySelector('#wgb-agent-mode').textContent = 'Сервис временно недоступен';
    }
  }

  // Инициализация при готовности страницы
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initWidgetDOM();
      checkAgentStatus();
    });
  } else {
    initWidgetDOM();
    checkAgentStatus();
  }
})();
