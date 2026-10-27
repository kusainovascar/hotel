/* The page calculator and assistant use the same public tariff source. */
(async function () {
  'use strict';
  const base=(window.WGB_ASSISTANT_CONFIG?.apiBase || '').replace(/\/$/,'');
  const staticPage=location.hostname.endsWith('.github.io') && !base;
  const endpoint=staticPage ? new URL('assistant-knowledge.json',document.currentScript.src) : (base || '/api')+'/agent/knowledge';
  try {
    const response=await fetch(endpoint,{cache:'no-store',signal:AbortSignal.timeout(10000)});
    if (!response.ok) throw new Error('Tariff source unavailable');
    const {pricing}=await response.json();
    if (!pricing || !Number.isFinite(pricing.roomRate) || !pricing.meals) throw new Error('Invalid tariff data');
    CONFIG.roomRate=pricing.roomRate;
    CONFIG.maxGroup=pricing.maxGuests;
    CONFIG.meals=pricing.meals;
    document.querySelector('#guests').max=pricing.maxGuests;
    document.querySelector('#tariff-note').textContent=`${pricing.status==='verified'?'Предварительный':'Демонстрационный'} расчёт по базе: ${money(pricing.roomRate)} за номер в сутки. Питание — за гостя в день. Трансфер и дополнительные услуги не включены. Наличие не подтверждено.`;
    updateGroup();
  } catch (error) {
    document.querySelector('#tariff-note').textContent='Источник актуальных тарифов недоступен. Показаны демонстрационные значения страницы; стоимость необходимо подтвердить у отеля.';
  }
})();
