'use strict';

/**
 * Сервисный модуль интеграции с CRM Bitrix24 через REST Webhook.
 */
class CrmService {
  /**
   * Отправка лида в Bitrix24
   * @param {Object} lead - Объект заявки
   * @param {string} webhookUrl - URL вебхука Bitrix24
   */
  async sendLeadToBitrix(lead, webhookUrl) {
    if (!webhookUrl || typeof webhookUrl !== 'string' || !webhookUrl.trim()) {
      return {
        success: false,
        status: 'not_configured',
        message: 'Вебхук Bitrix24 не настроен (интеграция работает в тестовом режиме)'
      };
    }

    // Приведение URL к вызову crm.lead.add
    let endpoint = webhookUrl.trim();
    if (!endpoint.endsWith('.json')) {
      if (endpoint.endsWith('/')) {
        endpoint += 'crm.lead.add.json';
      } else {
        endpoint += '/crm.lead.add.json';
      }
    }

    const title = `Заявка с сайта WGB: ${lead.name || 'Гость'} ${lead.company ? `(${lead.company})` : ''}`.trim();
    const commentLines = [
      `<b>Источник:</b> ИИ-консультант WGB`,
      `<b>Даты:</b> ${lead.dates?.start || 'Не указаны'} — ${lead.dates?.end || 'Не указаны'}`,
      `<b>Гостей:</b> ${lead.guests || 1}`,
      `<b>Номеров:</b> ${lead.rooms || 1}`,
      lead.company ? `<b>Компания:</b> ${lead.company}` : '',
      lead.wishes ? `<b>Пожелания:</b> ${lead.wishes}` : '',
      lead.summary ? `<b>Резюме диалога с ИИ:</b><br>${lead.summary.replace(/\n/g, '<br>')}` : ''
    ].filter(Boolean).join('<br>');

    const payload = {
      fields: {
        TITLE: title,
        NAME: lead.name || 'Гость',
        COMPANY_TITLE: lead.company || '',
        PHONE: lead.phone ? [{ VALUE: lead.phone, VALUE_TYPE: 'WORK' }] : [],
        EMAIL: lead.email ? [{ VALUE: lead.email, VALUE_TYPE: 'WORK' }] : [],
        COMMENTS: commentLines,
        SOURCE_ID: 'WEB',
        OPENED: 'Y',
        STATUS_ID: 'NEW'
      },
      params: { REGISTER_SONET_EVENT: 'Y' }
    };

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await response.json();

      if (response.ok && data.result) {
        return {
          success: true,
          status: 'synced',
          crmId: data.result,
          message: `Лид успешно создан в Bitrix24 (ID: ${data.result})`
        };
      } else {
        return {
          success: false,
          status: 'error',
          message: data.error_description || data.error || 'Ошибка при создании лида в Bitrix24'
        };
      }
    } catch (err) {
      return {
        success: false,
        status: 'error',
        message: `Сетевая ошибка при обращении к Bitrix24: ${err.message}`
      };
    }
  }

  /**
   * Тест подключения к вебхуку Bitrix24
   */
  async testConnection(webhookUrl) {
    if (!webhookUrl || !webhookUrl.trim()) {
      return { success: false, message: 'URL вебхука не указан' };
    }

    let endpoint = webhookUrl.trim();
    if (!endpoint.endsWith('.json')) {
      if (endpoint.endsWith('/')) {
        endpoint += 'server.time.json';
      } else {
        endpoint += '/server.time.json';
      }
    } else {
      endpoint = endpoint.replace(/crm\.[a-z.]+\.json$/i, 'server.time.json');
    }

    try {
      const res = await fetch(endpoint);
      const data = await res.json();
      if (res.ok && data.result) {
        return {
          success: true,
          message: 'Подключение к Bitrix24 успешно проверено!',
          serverTime: data.result
        };
      }
      return {
        success: false,
        message: data.error_description || data.error || 'Ошибка ответа Bitrix24'
      };
    } catch (err) {
      return {
        success: false,
        message: `Не удалось связаться с Bitrix24: ${err.message}`
      };
    }
  }
}

module.exports = new CrmService();
