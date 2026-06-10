'use strict';
const fs = require('fs');
const path = require('path');
const levels = require('../server/levels');
const out = {};
levels.all().forEach((x) => { out[x.level] = { title: x.title, task: x.task, hints: x.hints }; });
fs.writeFileSync(path.join(__dirname, '..', 'public', 'levels.json'), JSON.stringify(out, null, 2));
console.log('wrote public/levels.json with', Object.keys(out).length, 'levels');
