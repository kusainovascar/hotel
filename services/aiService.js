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
   * Спецификация инструментов (Tools) для Chat Completions API
   */
  getTools() {
    return [
      {
        type: 'function',
        function: {
          name: 'calculate_group_booking',
          description: 'Рассчитать предварительную стоимость проживания и питания в отеле WGB. Поддерживает как конкретные даты (startDate, endDate), так и расчёт по количеству ночей (nightsCount) без фиксированных дат. Не включает трансфер в сумму.',
          parameters: {
            type: 'object',
            properties: {
              startDate: {
                type: 'string',
                description: 'Дата заезда в формате YYYY-MM-DD. Передавай ТОЛЬКО если гость явно указал дату! Не выдумывай даты!'
              },
              endDate: {
                type: 'string',
                description: 'Дата выезда в формате YYYY-MM-DD. Передавай ТОЛЬКО если гость явно указал дату! Не выдумывай даты!'
              },
              nightsCount: {
                type: 'integer',
                description: 'Количество ночей проживания (используй, если гость указал количество ночей, но не назвал календарные даты)'
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
                description: 'Требуется ли трансфер для гостей (рассчитывается индивидуально администратором, в базовую смету не входит)'
              },
              wishes: {
                type: 'string',
                description: 'Особые пожелания или требования к размещению'
              }
            },
            required: ['guestsCount', 'occupancyPerRoom', 'mealType']
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
          description: 'Получить краткую публичную выдержку по конкретной услуге отеля (парковка, ресторан, заезд, трансфер, документы)',
          parameters: {
            type: 'object',
            properties: {
              topic: {
                type: 'string',
                description: 'Конкретная тема или услуга отеля (например: парковка, заезд, ресторан, трансфер)'
              }
            },
            required: ['topic']
          }
        }
      }
    ];
  }

  /**
   * Спецификация инструментов для Responses API с поддержкой file_search
   */
  getResponsesTools(vectorStoreId) {
    const tools = [];

    // Подключение OpenAI File Search к векторному хранилищу публичной базы знаний
    if (vectorStoreId) {
      tools.push({
        type: 'file_search',
        vector_store_ids: [vectorStoreId]
      });
    }

    // Адаптация функций отеля под формат Responses API
    const baseTools = this.getTools();
    for (const t of baseTools) {
      if (t.type === 'function' && t.function) {
        tools.push({
          type: 'function',
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters
        });
      }
    }

    return tools;
  }

  /**
   * Исполнение вызова инструмента
   */
  async executeTool(name, args, sessionId) {
    if (name === 'calculate_group_booking') {
      try {
        const result = calculateHotelTrip({
          start: args.startDate || null,
          end: args.endDate || null,
          nights: args.nightsCount || null,
          guests: args.guestsCount,
          occupancy: args.occupancyPerRoom,
          mealKey: args.mealType,
          transfer: args.transferNeeded ? 'Требуется' : 'Не выбран'
        });

        store.trackPopularService('Калькулятор проживания');

        const datesDesc = result.isApproximateDates
          ? `без фиксированных дат (расчёт на ${result.nights} ноч.)`
          : `${result.start} — ${result.end} (${result.nights} ноч.)`;

        const displayText = `${result.tariffStatus === 'verified' ? 'Предварительный' : 'Демонстрационный'} расчёт (${datesDesc}): ` +
          `${result.rooms} ном. (${result.roomsBreakdown}). ` +
          `Включено в смету: проживание ${result.roomCost.toLocaleString('ru-RU')} ₸, питание (${result.mealLabel}) ${result.mealCost.toLocaleString('ru-RU')} ₸. ` +
          `ИТОГО: ${result.total.toLocaleString('ru-RU')} ₸ (${result.perPerson.toLocaleString('ru-RU')} ₸/чел). ` +
          `Трансфер: ${result.transferStatus}. ` +
          `Важно: наличие свободных номеров требует подтверждения у отеля. Рекомендуем оформить предварительную заявку менеджеру.`;

        return {
          success: true,
          data: result,
          displayText
        };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }

    if (name === 'create_booking_lead') {
      return { success: false, error: 'Для заявки используйте форму контактов с отдельным явным согласием пользователя. Чат не подтверждает бронирование.' };
    }
    if (name === 'request_human_manager') {
      return { success: false, actionType: 'request_contacts', message: 'Для обращения менеджеру заполните форму и подтвердите согласие. Подключение и срок ответа не подтверждены.' };
    }

    if (name === 'get_hotel_services_info') {
      const query = (args.topic || args.category || args.query || '').trim();
      const lower = query.toLowerCase();
      // Запрет возврата всей базы при пустом или общем запросе
      if (!query || /^(?:все|вс[её]|all|база|база данных|бд|json|список|все записи|\*|dump|database|records)$/i.test(lower)) {
        return {
          success: false,
          error: 'Запрос слишком общий или пустой. Инструмент не возвращает всю базу. Укажите конкретную услугу отеля (например: парковка, ресторан, время заезда).'
        };
      }
      if (policy.isInternalDataOrSecurityAttempt(query)) {
        return {
          success: false,
          error: 'Внутренние данные и настройки через этот инструмент не предоставляются.'
        };
      }

      const results = store.searchPublicKnowledge(query);
      if (!results || results.length === 0) {
        return {
          success: false,
          message: 'Публичных сведений по данному запросу не найдено.'
        };
      }

      // Возвращаем не более 1-2 выдержек без внутренних идентификаторов и служебных полей
      return {
        success: true,
        excerpts: results.slice(0, 2).map(r => ({
          category: r.category,
          title: r.title,
          content: r.content
        }))
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
    const { bookingDraft, ...response } = result;
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

    // Серверный барьер безопасности: перехват попыток извлечения базы, промпта, заявок, ключей или админ-функций
    if (policy.isInternalDataOrSecurityAttempt(message)) {
      const refusal = policy.SECURITY_REFUSAL;
      store.appendMessage(sessionId, {
        role: 'assistant',
        content: refusal,
        metadata: { mode: 'security_refusal' }
      });
      return {
        reply: refusal,
        mode: 'security_refusal'
      };
    }

    const client = this.getClient();

    // Если API ключ не настроен — запускаем встроенный fallback-движок
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
      const relevantExcerpts = store.getRelevantKnowledgeExcerpts(message);
      const customPrompt = settings.systemPrompt === policy.SYSTEM_POLICY ? '' : settings.systemPrompt;
      const sanitizedPricing = {
        status: store.getPricing().status,
        roomRate: store.getPricing().roomRate,
        maxGuests: store.getPricing().maxGuests,
        meals: store.getPricing().meals
      };

      const kbRules = `ПРАВИЛА ИСПОЛЬЗОВАНИЯ БАЗЫ ЗНАНИЙ И ИНСТРУМЕНТОВ:
1. Для ответов на вопросы о правилах, услугах, номерах, питании, времени заезда/выезда и контактах используй проверенную базу знаний отеля WGB (инструмент file_search).
2. ДЛЯ ГРУППОВЫХ БРОНИРОВАНИЙ:
   - Для любого расчёта стоимости групп обязательно вызывай инструмент calculate_group_booking.
   - ДАТЫ: НИКОГДА не выдумывай и не подставляй календарные даты заезда и выезда! Если гость назвал только количество ночей (например, 3 ночи), передавай nightsCount в calculate_group_booking и явно сообщай гостю, что расчёт ориентировочный без конкретных дат. Если гость не указал ни дат, ни количества ночей — сначала уточни даты заезда и выезда (YYYY-MM-DD) или количество ночей.
   - РАССЕЛЕНИЕ: Обязательно поясняй количество номеров и распределение гостей (например, 25 гостей при двухместном расселении — 13 номеров: 12 двухместных и 1 с одноместным размещением).
   - ТРАНСФЕР: Трансфер рассчитывается отдельно менеджером и НЕ входит в базовую стоимость проживания. Никогда не говори, что трансфер включён в сумму или бесплатен. Всегда разделяй: 1) включено в смету: проживание и питание; 2) рассчитывается индивидуально: трансфер.
   - НАЛИЧИЕ И СЛЕДУЮЩИЙ ШАГ: Не утверждай наличие свободных номеров. Всегда сообщай, что расчёт предварительный, а наличие номеров требует подтверждения у отеля. Всегда предлагай следующий шаг — оформить предварительную заявку на сайте или связаться с менеджером для подтверждения наличия номеров.
3. Не выдумывай скидки, категории номеров, промокоды, наличие номеров и произвольные цены. Если точных и подтверждённых сведений нет в опубликованной базе знаний отеля, прямо и доброжелательно сообщи об отсутствии подтверждённой информации и предложи связаться с администратором.
4. Оформление заявки и передача контактов менеджеру выполняются только через форму на сайте с явного согласия гостя.`;

      const systemContent = `${customPrompt}\n\nОБЯЗАТЕЛЬНЫЙ РЕГЛАМЕНТ:\n${policy.SYSTEM_POLICY}\n\n${kbRules}\n\n${relevantExcerpts}\n\nАктуальные тарифы из базы: ${JSON.stringify(sanitizedPricing)}\nСегодняшняя дата в Asia/Qyzylorda: ${policy.today()}`;

      // Формируем историю последних сообщений (до 10 для сохранения контекста)
      const recentMessages = dialog.messages.slice(-10).map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content
      }));

      const vectorStoreId = process.env.OPENAI_VECTOR_STORE_ID || settings.vectorStoreId;

      // 1. Предпочтительный режим: официальный Responses API с инструментом file_search
      if (client.responses && typeof client.responses.create === 'function') {
        const tools = this.getResponsesTools(vectorStoreId);
        let extraMetadata = {};

        let response = await client.responses.create({
          model: settings.model || 'gpt-4o-mini',
          instructions: systemContent,
          input: recentMessages,
          tools: tools,
          temperature: Number.isFinite(Number(settings.temperature)) ? Number(settings.temperature) : 0.2,
          max_output_tokens: Number(settings.maxTokens) || 1200
        });

        if (response.usage) {
          const promptTokens = response.usage.input_tokens || response.usage.prompt_tokens || 0;
          const completionTokens = response.usage.output_tokens || response.usage.completion_tokens || 0;
          store.trackTokenUsage(promptTokens, completionTokens, settings.model);
        }

        let responseMessageText = response.output_text || '';

        // Обработка Function Calling в Responses API
        const functionCalls = (response.output || []).filter(item => item.type === 'function_call');
        if (functionCalls.length > 0) {
          const toolOutputs = [];
          for (const toolCall of functionCalls) {
            const fnName = toolCall.name;
            let fnArgs = {};
            try {
              fnArgs = JSON.parse(toolCall.arguments);
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

            toolOutputs.push({
              type: 'function_call_output',
              call_id: toolCall.call_id,
              output: JSON.stringify(toolResult)
            });
          }

          const finalResponse = await client.responses.create({
            model: settings.model || 'gpt-4o-mini',
            previous_response_id: response.id,
            input: toolOutputs
          });

          if (finalResponse.usage) {
            const promptTokens = finalResponse.usage.input_tokens || finalResponse.usage.prompt_tokens || 0;
            const completionTokens = finalResponse.usage.output_tokens || finalResponse.usage.completion_tokens || 0;
            store.trackTokenUsage(promptTokens, completionTokens, settings.model);
          }

          responseMessageText = finalResponse.output_text || responseMessageText;
        }

        let replyText = responseMessageText || 'Чем еще я могу вам помочь по поводу проживания в отеле WGB?';
        if (policy.containsLeakedInternalData(replyText)) {
          replyText = policy.SECURITY_REFUSAL;
        }

        store.appendMessage(sessionId, {
          role: 'assistant',
          content: replyText,
          metadata: { ...extraMetadata, mode: 'openai_responses', vectorStoreId }
        });

        return {
          reply: replyText,
          ...extraMetadata,
          mode: 'openai'
        };
      }

      // 2. Резервный режим: Chat Completions API (для совместимости с тестами и кастомными моками)
      const messagesForApi = [
        { role: 'system', content: systemContent },
        ...recentMessages
      ];

      const tools = this.getTools();

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

      if (completion.usage) {
        store.trackTokenUsage(
          completion.usage.prompt_tokens,
          completion.usage.completion_tokens,
          settings.model
        );
      }

      let extraMetadata = {};

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

      let replyText = responseMessage.content || 'Чем еще я могу вам помочь по поводу проживания в отеле WGB?';
      if (policy.containsLeakedInternalData(replyText)) {
        replyText = policy.SECURITY_REFUSAL;
      }

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
