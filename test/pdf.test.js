'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { renderPdfBuffer } = require('../server/pdf');

const model = {
  header: 'Introduction to Linux — Bandit',
  name: 'Ada', email: 'ada@x.edu', levelLabel: 'Level 0 → 1',
  title: 'Log in and read a file', date: '2026-06-10T12:00:00Z',
  commands: ['ls', 'cat readme'], commandCount: 2,
  nextUser: 'bandit1', discoveredPassword: 'NEXTPW123',
};

test('renderPdfBuffer returns a PDF buffer', async () => {
  const buf = await renderPdfBuffer(model);
  assert.ok(Buffer.isBuffer(buf));
  assert.ok(buf.length > 500);
  assert.strictEqual(buf.slice(0, 5).toString('latin1'), '%PDF-');
});
