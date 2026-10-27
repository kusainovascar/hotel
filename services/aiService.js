'use strict';

const { OpenAI } = require('openai');
const store = require('../data/store');
const policy = require('./assistantPolicy');
const { calculateHotelTrip } = require('./hotelCalculator');

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
          description: 'Рассчитать предварительную стоимость проживания и питания в отеле WGB по тарифам базы с обязательным указанием их статуса (demo или verified)',
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
                description: 'Тип питания: none (без питания), breakfast (завтрак), half (полупансион), full (полный пансион)'
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
            required: ['startDate', 'endDate', 'guestsCount', 'occupancyPerRoom', 'mealType']
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
          occupancy: args.occupancyPerRoom,
          mealKey: args.mealType,
          transfer: args.transferNeeded ? 'Требуется' : 'Не выбран'
        });

        store.trackPopularService('Калькулятор проживания');

        return {
          success: true,
          data: result,
          displayText: `${result.tariffStatus === 'verified' ? 'Предварительный' : 'Демонстрационный'} расчёт: ${result.nights} ноч., ${result.rooms} ном., общее проживание ${result.roomCost.toLocaleString('ru-RU')} ₸, питание ${result.mealCost.toLocaleString('ru-RU')} ₸. ИТОГО: ${result.total.toLocaleString('ru-RU')} ₸ (${result.perPerson.toLocaleString('ru-RU')} ₸/чел).`
        };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }

    if (name === 'create_booking_lead') {
      return {success: false, error: 'Для заявки используйте форму контактов с отдельным явным согласием пользователя. Чат не подтверждает бронирование.'};
    }
    if (name === 'request_human_manager') {
      return {success: false, actionType: 'request_contacts', message: 'Для обращения менеджеру заполните форму и подтвердите согласие. Подключение и срок ответа не подтверждены.'};
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
    const dialog = store.getOrCreateDialog(sessionId);
    const result = policy.fallback(userMessage, store.getPublicAssistantContext(), dialog.bookingDraft);
    dialog.bookingDraft = result.bookingDraft;
    store.save();
    const {bookingDraft, ...response} = result;
    return response;
  }

  /**
   * Главный метод обработки сообщения от пользователя
   */
  async processMessage({ sessionId, message, visitorId }) {
    message = policy.validateMessage(message);
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
      const customPrompt = settings.systemPrompt === policy.SYSTEM_POLICY ? '' : settings.systemPrompt;
      const systemContent = `${customPrompt}\n\nОБЯЗАТЕЛЬНЫЙ РЕГЛАМЕНТ:\n${policy.SYSTEM_POLICY}\n\nБаза знаний (статусы записей обязательны):\n${kbContext}\n\nАктуальные тарифы из базы: ${JSON.stringify(store.getPricing())}\nСегодняшняя дата в Asia/Qyzylorda: ${policy.today()}`;

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
        temperature: Number.isFinite(Number(settings.temperature)) ? Number(settings.temperature) : 0.2,
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
          if (toolResult.actionType) extraMetadata.actionType = toolResult.actionType;
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
          temperature: Number.isFinite(Number(settings.temperature)) ? Number(settings.temperature) : 0.2,
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
        warning: 'ИИ временно недоступен. Ответ сформирован в справочном режиме из базы отеля.'
      };
    }
  }
}

module.exports = new AiService();
