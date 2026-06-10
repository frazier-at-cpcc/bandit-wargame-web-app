'use strict';
const { MIN_LEVEL, MAX_LEVEL } = require('./config');

function fail(reason) { return { ok: false, reason }; }
function ok(msg) { return { ok: true, msg }; }

function parseClientMessage(raw) {
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch (_) {
    return fail('invalid json');
  }
  if (!obj || typeof obj !== 'object') return fail('not an object');

  switch (obj.type) {
    case 'init': {
      const name = String(obj.name || '').trim();
      const email = String(obj.email || '').trim();
      if (!name || !email) return fail('name and email required');
      return ok({ type: 'init', name, email });
    }
    case 'connect': {
      const level = Number(obj.level);
      if (!Number.isInteger(level) || level < MIN_LEVEL || level > MAX_LEVEL) {
        return fail('level out of range');
      }
      const password = String(obj.password == null ? '' : obj.password);
      if (password.length === 0) return fail('password required');
      return ok({ type: 'connect', level, password });
    }
    case 'input': {
      if (typeof obj.data !== 'string') return fail('input data must be string');
      return ok({ type: 'input', data: obj.data });
    }
    case 'resize': {
      const cols = Number(obj.cols), rows = Number(obj.rows);
      if (!Number.isInteger(cols) || !Number.isInteger(rows)) return fail('bad resize');
      return ok({ type: 'resize', cols, rows });
    }
    default:
      return fail('unknown type');
  }
}

module.exports = { parseClientMessage };
