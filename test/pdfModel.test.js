'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { buildPdfModel } = require('../server/pdfModel');

const session = { name: 'Ada Lovelace', email: 'ada@x.edu' };
const finalized = { commands: ['ls', 'cat readme'], discoveredPassword: 'NEXTPW123' };

test('builds a model with identity, level, commands, and discovered password', () => {
  const m = buildPdfModel({ session, level: 0, finalized, dateIso: '2026-06-10T12:00:00Z' });
  assert.strictEqual(m.header, 'Introduction to Linux — Bandit');
  assert.strictEqual(m.name, 'Ada Lovelace');
  assert.strictEqual(m.email, 'ada@x.edu');
  assert.strictEqual(m.levelLabel, 'Level 0 → 1');
  assert.strictEqual(m.title, 'Log in and read a file');
  assert.strictEqual(m.date, '2026-06-10T12:00:00Z');
  assert.deepStrictEqual(m.commands, ['ls', 'cat readme']);
  assert.strictEqual(m.commandCount, 2);
  assert.strictEqual(m.nextUser, 'bandit1');
  assert.strictEqual(m.discoveredPassword, 'NEXTPW123');
});

test('uses HEADER_TEXT default and level title lookup', () => {
  const m = buildPdfModel({ session, level: 7, finalized, dateIso: '2026-06-10T00:00:00Z' });
  assert.strictEqual(m.levelLabel, 'Level 7 → 8');
  assert.strictEqual(m.title, 'Find a word in a big file');
  assert.strictEqual(m.nextUser, 'bandit8');
});
