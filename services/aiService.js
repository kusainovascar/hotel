'use strict';

const { OpenAI } = require('openai');
const store = require('../data/store');
const { calculateHotelTrip } = require('./hotelCalculator');
const crmService = require('./crmService');

class AiService {
  /**
   * Получение клиента OpenAI с актуальным ключом
   */
  getClient(customKey = null) {
    const settings = store.getSettings();
    const key = customKey || settings.apiKey || process.env.OPENAI_API_KEY;
    if (!key || !key.trim()) {
      return null;
    }
    return new OpenAI({ apiKey: key.trim() });
  }

  /**
   * Проверка подключения к OpenAI API
   */
  async testConnection(customKey = null, customModel = null) {
    const settings = store.getSettings();
    const key = customKey || settings.apiKey || process.env.OPENAI_API_KEY;
    const model = customModel || settings.model || 'gpt-4o-mini';

    if (!key || !key.trim()) {
      return {
        status: 'not_configured',
        connected: false,
        message: 'API-ключ OpenAI не задан. Введите ключ и нажмите «Сохранить» или «Проверить».'
      };
    }

    try {
      const client = new OpenAI({ apiKey: key.trim() });
      const response = await client.chat.completions.create({
        model: model,
        messages: [
          { role: 'system', content: 'You are a test ping agent. Reply with the single word "OK".' },
          { role: 'user', content: 'ping' }
        ],
        max_tokens: 5,
        temperature: 0
      });

      const reply = response.choices[0]?.message?.content?.trim();
      return {
        status: 'connected',
        connected: true,
        message: `Подключение к OpenAI успешно установлено! Модель: ${model}, ответ: "${reply}"`,
        model: model
      };
    } catch (err) {
      console.error('Ошибка проверки OpenAI API:', err.message);
      let errorDesc = err.message;
      if (err.status === 401) {
        errorDesc = 'Ошибка авторизации (401). Неверный API-ключ OpenAI.';
      } else if (err.status === 429) {
        errorDesc = 'Превышен лимит запросов или исчерпан баланс аккаунта OpenAI (429 Quota Exceeded).';
      } else if (err.status === 404) {
        errorDesc = `Указанная модель "${model}" не найдена или недоступна для этого API-ключа (404).`;
      }

      return {
        status: 'error',
        connected: false,
        message: errorDesc
      };
    }
  }

  /**
   * Спецификация инструментов (Tools) для OpenAI
   */
  getTools() {
    return [
      {
        type: 'function',
        function: {
          name: 'calculate_group_booking',
          description: 'Рассчитать предварительную стоимость проживания и питания в отеле WGB по официальным тарифам',
          parameters: {
            type: 'object',
            properties: {
              startDate: {
                type: 'string',
                description: 'Дата заезда в формате YYYY-MM-DD'
              },
              endDate: {
                type: 'string',
                description: 'Дата выезда в формате YYYY-MM-DD'
              },
              guestsCount: {
                type: 'integer',
                description: 'Общее количество гостей (от 1)'
              },
              occupancyPerRoom: {
                type: 'integer',
                enum: [1, 2],
                description: 'Схема расселения: 1 (один гость в номере) или 2 (два гостя в номере)'
              },
              mealType: {
                type: 'string',
                enum: ['none', 'breakfast', 'half', 'full'],
                description: 'Тип питания: none (без питания), breakfast (завтрак 4000₸), half (полупансион 10000₸), full (полный пансион 15000₸)'
              },
              transferNeeded: {
                type: 'boolean',
                description: 'Требуется ли трансфер для гостей'
              },
              wishes: {
                type: 'string',
                description: 'Особые пожелания или требования к размещению'
              }
            },
            required: ['startDate', 'endDate', 'guestsCount']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'create_booking_lead',
          description: 'Сформировать официальную заявку на индивидуальное или групповое бронирование для передачи менеджерам отеля',
          parameters: {
            type: 'object',
            properties: {
              clientName: {
                type: 'string',
                description: 'Имя и фамилия контактного лица'
              },
              company: {
                type: 'string',
                description: 'Название компании или организации (если поездка корпоративная)'
              },
              phone: {
                type: 'string',
                description: 'Контактный номер телефона'
              },
              email: {
                type: 'string',
                description: 'Контактный адрес электронной почты'
              },
              startDate: {
                type: 'string',
                description: 'Дата заезда (YYYY-MM-DD)'
              },
              endDate: {
                type: 'string',
                description: 'Дата выезда (YYYY-MM-DD)'
              },
              guestsCount: {
                type: 'integer',
                description: 'Количество гостей'
              },
              roomsCount: {
                type: 'integer',
                description: 'Количество номеров'
              },
              wishes: {
                type: 'string',
                description: 'Пожелания к размещению, питанию, документам'
              },
              conversationSummary: {
                type: 'string',
                description: 'Краткое содержание диалога и ключевые договоренности с клиентом'
              }
            },
            required: ['clientName', 'phone']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'request_human_manager',
          description: 'Передать диалог живому менеджеру отеля или запросить звонок/консультацию человека',
          parameters: {
            type: 'object',
            properties: {
              clientName: {
                type: 'string',
                description: 'Имя клиента'
              },
              contactInfo: {
                type: 'string',
                description: 'Телефон или Email для связи'
              },
              reason: {
                type: 'string',
                description: 'Причина вызова менеджера или тема обращения'
              }
            },
            required: ['reason']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'get_hotel_services_info',
          description: 'Получить актуальную информацию из базы знаний отеля WGB (номера, питание, трансфер, документы, правила)',
          parameters: {
            type: 'object',
            properties: {
              category: {
                type: 'string',
                description: 'Категория или ключевое слово для поиска информации'
              }
            }
          }
        }
      }
    ];
  }

  /**
   * Исполнение вызова инструмента
   */
  async executeTool(name, args, sessionId) {
    if (name === 'calculate_group_booking') {
      try {
        const result = calculateHotelTrip({
          start: args.startDate,
          end: args.endDate,
          guests: args.guestsCount,
          occupancy: args.occupancyPerRoom || 2,
          mealKey: args.mealType || 'none',
          transfer: args.transferNeeded ? 'Требуется' : 'Не выбран'
        });

        store.trackPopularService('Калькулятор проживания');

        return {
          success: true,
          data: result,
          displayText: `Расчёт: ${result.nights} ноч., ${result.rooms} ном., общее проживание ${result.roomCost.toLocaleString('ru-RU')} ₸, питание ${result.mealCost.toLocaleString('ru-RU')} ₸. ИТОГО: ${result.total.toLocaleString('ru-RU')} ₸ (${result.perPerson.toLocaleString('ru-RU')} ₸/чел).`
        };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }

    if (name === 'create_booking_lead') {
      try {
        const settings = store.getSettings();
        const lead = store.addLead({
          name: args.clientName,
          company: args.company,
          phone: args.phone,
          email: args.email,
          dates: { start: args.startDate, end: args.endDate },
          guests: args.guestsCount,
          rooms: args.roomsCount,
          wishes: args.wishes,
          summary: args.conversationSummary || 'Заявка оформлена через ИИ-консультанта',
          source: 'ai_agent'
        });

        // Отправка в CRM Bitrix24
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

        return {
          success: true,
          leadId: lead.id,
          message: 'Заявка успешно зарегистрирована в системе отеля WGB. Менеджер свяжется с клиентом.'
        };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }

    if (name === 'request_human_manager') {
      store.trackManagerHandoff();
      store.trackPopularService('Связь с менеджером');

      if (args.contactInfo) {
        store.addLead({
          name: args.clientName || 'Гость (запрос менеджера)',
          phone: args.contactInfo,
          wishes: `Запрос связи с менеджером. Причина: ${args.reason || 'Вопрос клиента'}`,
          summary: `Клиент запросил связь с живым специалистом: ${args.reason || ''}`,
          source: 'manager_handoff'
        });
      }

      return {
        success: true,
        message: 'Запрос на связь с менеджером зафиксирован. Специалист отеля подключится или перезвонит.'
      };
    }

    if (name === 'get_hotel_services_info') {
      const kb = store.getKnowledgeBaseContext();
      return {
        success: true,
        knowledge: kb
      };
    }

    return { error: `Неизвестный инструмент: ${name}` };
  }

  /**
   * Интеллектуальный локальный fallback (если OpenAI ключ не настроен или сервис недоступен)
   */
  generateFallbackResponse(userMessage, sessionId) {
    const text = userMessage.toLowerCase();
    const settings = store.getSettings();

    // Отслеживаем категорию
    if (text.includes('цен') || text.includes('тариф') || text.includes('стоим') || text.includes('номер')) {
      store.trackPopularQuestion('Номера и цены');
      return {
        reply: `В отеле WGB представлены уютные номера категорий:\n• **«Комфорт»** (для индивидуальных деловых поездок, большая кровать, рабочая зона) — от 30 000 ₸/сутки;\n• **«Команда вместе / Твин»** (для групп и коллег с раздельной или гибкой схематикой) — от 30 000 ₸ за номер.\n\nХотите рассчитать даты или оставить контакты для бронирования?`,
        suggestedActions: ['Рассчитать групповое проживание', 'Забронировать номер', 'Связаться с менеджером']
      };
    }

    if (text.includes('заезд') || text.includes('выезд') || text.includes('check-in') || text.includes('время')) {
      store.trackPopularQuestion('Время заезда/выезда');
      return {
        reply: `Стандартное время заезда в отель WGB — **с 14:00**, выезд — **до 12:00**.\n\nРанний заезд и поздний выезд возможны при наличии номеров и согласуются с администратором. Стойка регистрации работает круглосуточно (24/7).`,
        suggestedActions: ['Забронировать номер', 'Связаться с менеджером']
      };
    }

    if (text.includes('питани') || text.includes('завтрак') || text.includes('обед') || text.includes('ужин') || text.includes('ресторан')) {
      store.trackPopularQuestion('Ресторан и питание');
      return {
        reply: `В ресторане отеля WGB доступны следующие варианты питания:\n• **Завтрак (шведский стол):** 4 000 ₸/гостя;\n• **Полупансион (завтрак + ужин):** 10 000 ₸/гостя;\n• **Полный пансион (завтрак + обед + ужин):** 15 000 ₸/гостя.\n\nДля групп возможно согласование индивидуального меню и кофе-брейков.`,
        suggestedActions: ['Рассчитать групповое проживание', 'Связаться с менеджером']
      };
    }

    if (text.includes('документ') || text.includes('бухгалтер') || text.includes('эсф') || text.includes('авр') || text.includes('безнал') || text.includes('командировк')) {
      store.trackPopularQuestion('Документы и командировки');
      return {
        reply: `Для командировочных гостей и юридических лиц отель WGB предоставляет полный пакет закрывающих документов: ЭСФ, акты выполненных работ (АВР), фискальные чеки и справки о проживании. Оплата возможна по безналичному расчету по счету на оплату или картой.`,
        suggestedActions: ['Организовать деловую поездку', 'Связаться с менеджером']
      };
    }

    if (text.includes('менеджер') || text.includes('человек') || text.includes('оператор') || text.includes('позвон')) {
      store.trackManagerHandoff();
      return {
        reply: `Я с радостью передам ваш запрос менеджеру отеля WGB. Пожалуйста, укажите ваше **имя и номер телефона** (или email), и специалист свяжется с вами в течение 10–15 минут.`,
        actionType: 'request_contacts',
        suggestedActions: ['Оставить контакты']
      };
    }

    if (text.includes('рассчит') || text.includes('калькулятор') || text.includes('групп')) {
      store.trackPopularQuestion('Групповой расчет');
      return {
        reply: `Для точного расчета группового проживания укажите:\n1. Планируемые даты заезда и выезда\n2. Количество гостей\n3. Необходимость питания (завтрак, полупансион, полный пансион)\n\nТакже вы можете воспользоваться удобным калькулятором на сайте с выгрузкой сметы в Excel.`,
        suggestedActions: ['Рассчитать групповое проживание', 'Связаться с менеджером']
      };
    }

    // Общий доброжелательный ответ
    return {
      reply: `Благодарю за вопрос! Я могу помочь вам:\n• Подобрать номер для командировки или отдыха\n• Рассчитать стоимость проживания для группы\n• Рассказать о ресторане, питании и закрывающих документах\n• Передать ваш вопрос менеджеру отеля\n\nПодскажите, какие даты или услуги вас интересуют?`,
      suggestedActions: ['Забронировать номер', 'Рассчитать групповое проживание', 'Связаться с менеджером']
    };
  }

  /**
   * Главный метод обработки сообщения от пользователя
   */
  async processMessage({ sessionId, message, visitorId }) {
    const settings = store.getSettings();

    if (!settings.isActive) {
      return {
        reply: 'Чат-консультант временно отключен администрацией отеля. Пожалуйста, воспользуйтесь формой на сайте или свяжитесь с нами по телефону.',
        disabled: true
      };
    }

    // Сохраняем сессию и сообщение пользователя
    const dialog = store.getOrCreateDialog(sessionId, visitorId);
    store.appendMessage(sessionId, { role: 'user', content: message });

    const client = this.getClient();

    // Если API ключ не настроен — запускаем качественный встроенный fallback-движок
    if (!client) {
      const fallback = this.generateFallbackResponse(message, sessionId);
      store.appendMessage(sessionId, {
        role: 'assistant',
        content: fallback.reply,
        metadata: {
          mode: 'fallback_no_api_key',
          suggestedActions: fallback.suggestedActions,
          actionType: fallback.actionType
        }
      });

      return {
        reply: fallback.reply,
        suggestedActions: fallback.suggestedActions,
        actionType: fallback.actionType,
        mode: 'fallback'
      };
    }

    // Если клиент доступен — вызываем OpenAI API
    try {
      const kbContext = store.getKnowledgeBaseContext();
      const systemContent = `${settings.systemPrompt}\n\nБаза знаний отеля WGB (используй только эти подтвержденные данные):\n${kbContext}\n\nСегодняшняя дата: ${new Date().toISOString().split('T')[0]}`;

      // Формируем историю последних сообщений (до 10 для сохранения контекста)
      const recentMessages = dialog.messages.slice(-10).map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content
      }));

      const messagesForApi = [
        { role: 'system', content: systemContent },
        ...recentMessages
      ];

      const tools = this.getTools();

      // Первый вызов OpenAI API
      let completion = await client.chat.completions.create({
        model: settings.model || 'gpt-4o-mini',
        messages: messagesForApi,
        tools: tools,
        tool_choice: 'auto',
        temperature: Number(settings.temperature) || 0.7,
        max_tokens: Number(settings.maxTokens) || 1200
      });

      let choice = completion.choices[0];
      let responseMessage = choice.message;

      // Трекинг токенов
      if (completion.usage) {
        store.trackTokenUsage(
          completion.usage.prompt_tokens,
          completion.usage.completion_tokens,
          settings.model
        );
      }

      let extraMetadata = {};

      // Обработка Function Calling / Tools
      if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
        messagesForApi.push(responseMessage);

        for (const toolCall of responseMessage.tool_calls) {
          const fnName = toolCall.function.name;
          let fnArgs = {};
          try {
            fnArgs = JSON.parse(toolCall.function.arguments);
          } catch (e) {
            console.error('Ошибка парсинга аргументов инструмента:', e);
          }

          const toolResult = await this.executeTool(fnName, fnArgs, sessionId);

          if (fnName === 'calculate_group_booking' && toolResult.data) {
            extraMetadata.calculation = toolResult.data;
          }
          if (fnName === 'create_booking_lead' && toolResult.leadId) {
            extraMetadata.leadCreated = true;
            extraMetadata.leadId = toolResult.leadId;
          }

          messagesForApi.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(toolResult)
          });
        }

        // Второй вызов OpenAI с результатами выполнения инструментов
        const finalCompletion = await client.chat.completions.create({
          model: settings.model || 'gpt-4o-mini',
          messages: messagesForApi,
          temperature: Number(settings.temperature) || 0.7,
          max_tokens: Number(settings.maxTokens) || 1200
        });

        if (finalCompletion.usage) {
          store.trackTokenUsage(
            finalCompletion.usage.prompt_tokens,
            finalCompletion.usage.completion_tokens,
            settings.model
          );
        }

        responseMessage = finalCompletion.choices[0].message;
      }

      const replyText = responseMessage.content || 'Чем еще я могу вам помочь по поводу проживания в отеле WGB?';

      // Сохраняем ответ ассистента в историю
      store.appendMessage(sessionId, {
        role: 'assistant',
        content: replyText,
        metadata: { ...extraMetadata, mode: 'openai' }
      });

      return {
        reply: replyText,
        ...extraMetadata,
        mode: 'openai'
      };
    } catch (err) {
      console.error('Ошибка при обращении к OpenAI API:', err);
      // При ошибке OpenAI переключаемся на fallback, не роняя приложение
      const fallback = this.generateFallbackResponse(message, sessionId);
      store.appendMessage(sessionId, {
        role: 'assistant',
        content: fallback.reply,
        metadata: { mode: 'fallback_error', error: err.message }
      });

      return {
        reply: fallback.reply,
        suggestedActions: fallback.suggestedActions,
        actionType: fallback.actionType,
        mode: 'fallback',
        warning: `Ответ сформирован встроенной базой знаний отеля (OpenAI API временно недоступен: ${err.message})`
      };
    }
  }
}

module.exports = new AiService();
