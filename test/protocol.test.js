'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { parseClientMessage } = require('../server/protocol');

test('parses init', () => {
  const r = parseClientMessage(JSON.stringify({ type: 'init', name: 'Ada', email: 'a@x.edu' }));
  assert.deepStrictEqual(r, { ok: true, msg: { type: 'init', name: 'Ada', email: 'a@x.edu' } });
});

test('parses connect with numeric level coercion', () => {
  const r = parseClientMessage(JSON.stringify({ type: 'connect', level: '3', password: 'pw' }));
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.msg, { type: 'connect', level: 3, password: 'pw' });
});

test('parses input and resize', () => {
  assert.deepStrictEqual(
    parseClientMessage(JSON.stringify({ type: 'input', data: 'l' })),
    { ok: true, msg: { type: 'input', data: 'l' } });
  assert.deepStrictEqual(
    parseClientMessage(JSON.stringify({ type: 'resize', cols: 80, rows: 24 })),
    { ok: true, msg: { type: 'resize', cols: 80, rows: 24 } });
});

test('rejects invalid JSON', () => {
  const r = parseClientMessage('{not json');
  assert.strictEqual(r.ok, false);
});

test('rejects unknown type', () => {
  const r = parseClientMessage(JSON.stringify({ type: 'launchMissiles' }));
  assert.strictEqual(r.ok, false);
});

test('rejects connect with out-of-range level', () => {
  const r = parseClientMessage(JSON.stringify({ type: 'connect', level: 99, password: 'pw' }));
  assert.strictEqual(r.ok, false);
});

test('rejects connect with empty password', () => {
  const r = parseClientMessage(JSON.stringify({ type: 'connect', level: 1, password: '' }));
  assert.strictEqual(r.ok, false);
});

test('rejects object password', () => {
  const r = parseClientMessage(JSON.stringify({ type: 'connect', level: 1, password: { x: 1 } }));
  assert.strictEqual(r.ok, false);
});

test('rejects empty-string level', () => {
  const r = parseClientMessage(JSON.stringify({ type: 'connect', level: '', password: 'pw' }));
  assert.strictEqual(r.ok, false);
});

test('rejects non-scalar name in init', () => {
  const r = parseClientMessage(JSON.stringify({ type: 'init', name: { a: 1 }, email: 'a@x.edu' }));
  assert.strictEqual(r.ok, false);
});

test('rejects non-positive resize', () => {
  const r = parseClientMessage(JSON.stringify({ type: 'resize', cols: -1, rows: 24 }));
  assert.strictEqual(r.ok, false);
});
