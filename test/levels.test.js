'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const levels = require('../server/levels');

test('getLevel returns metadata with title, task, hints and NO solution', () => {
  const lvl = levels.getLevel(0);
  assert.strictEqual(lvl.level, 0);
  assert.strictEqual(typeof lvl.title, 'string');
  assert.ok(lvl.title.length > 0);
  assert.strictEqual(typeof lvl.task, 'string');
  assert.ok(Array.isArray(lvl.hints));
  assert.ok(lvl.hints.length > 0);
  // Pedagogy guard: metadata must never carry a solution/answer field.
  assert.strictEqual(lvl.solution, undefined);
  assert.strictEqual(lvl.password, undefined);
});

test('all levels 0..24 exist with required fields', () => {
  for (let n = 0; n <= 24; n++) {
    const lvl = levels.getLevel(n);
    assert.ok(lvl, `level ${n} should exist`);
    assert.ok(lvl.title && lvl.task && lvl.hints.length, `level ${n} fields`);
  }
});

test('getLevel returns null for out-of-range', () => {
  assert.strictEqual(levels.getLevel(-1), null);
  assert.strictEqual(levels.getLevel(25), null);
});

test('count reflects 0..24 inclusive', () => {
  assert.strictEqual(levels.count(), 25);
});
