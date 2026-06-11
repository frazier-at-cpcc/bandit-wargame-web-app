'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const config = require('../server/config');

test('config exposes the bandit host and level range', () => {
  assert.strictEqual(config.BANDIT_HOST, 'bandit.labs.overthewire.org');
  assert.strictEqual(config.BANDIT_PORT, 2220);
  assert.strictEqual(config.MIN_LEVEL, 0);
  assert.strictEqual(config.MAX_LEVEL, 24);
});
