'use strict';
// Exports only explicitly public knowledge and public pricing, never the database.
const fs = require('node:fs');
const path = require('node:path');
const store = require('../data/store');
fs.writeFileSync(path.join(__dirname, '..', 'assistant-knowledge.json'), JSON.stringify(store.getPublicAssistantContext(), null, 2) + '\n');
console.log('Public assistant knowledge snapshot exported. Review demo/verified labels before publishing.');
