'use strict';

require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

const apiRoutes = require('./routes/api');
const adminRoutes = require('./routes/admin');
const store = require('./data/store');

const app = express();
const portFlag = process.argv.indexOf('--port');
const PORT = Number(process.env.PORT || (portFlag >= 0 ? process.argv[portFlag + 1] : 3000));

// Безопасность и парсинг тела запросов
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// Логирование запросов в режиме разработки без раскрытия конфиденциальных данных
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    // Логируем только путь, статус и время ответа
    if (req.path.startsWith('/api')) {
      console.log(`[${new Date().toLocaleTimeString('ru-RU')}] ${req.method} ${req.path} -> ${res.statusCode} (${duration}ms)`);
    }
  });
  next();
});

// Подключение API маршрутов
app.use('/api', apiRoutes);
app.use('/api/admin', adminRoutes);

// Статические файлы админ-панели
app.use('/admin', express.static(path.join(__dirname, 'public', 'admin')));

// Статические файлы проекта (главный сайт, стили виджета, скрипты)
// Only public assets are served. Database, settings and source are never public.
for (const filename of ['index.html','wgb-logo.webp','widget.js','widget.css','assistant-policy.js','pricing-sync.js','assistant-config.js','assistant-knowledge.json']) {
  app.get('/' + filename, (req,res) => res.sendFile(path.join(__dirname, filename)));
}

// Прямой доступ к панели администратора
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html'));
});

// Главная страница
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Глобальный обработчик ошибок
app.use((err, req, res, next) => {
  console.error('Необработанная ошибка сервера:', err.message);
  res.status(err.status || 500).json({
    error: 'Внутренняя ошибка сервера',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Произошла непредвиденная ошибка'
  });
});

const server = app.listen(PORT, () => {
  const settings = store.getSettings();
  console.log('====================================================');
  console.log(`🏨 hotel v.2 — сервер WGB с ИИ-агентом и базой данных запущен!`);
  console.log(`🌐 Сайт: http://localhost:${PORT}`);
  console.log(`⚙️  Панель управления: http://localhost:${PORT}/admin`);
  console.log(`🤖 Модель OpenAI: ${settings.model}`);
  console.log(`🔑 Статус API-ключа: ${(settings.apiKey || process.env.OPENAI_API_KEY) ? 'Настроен' : 'Не настроен (работает fallback)'}`);
  console.log('====================================================');
});

module.exports = { app, server };
