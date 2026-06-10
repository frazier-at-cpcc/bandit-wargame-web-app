'use strict';
const { MIN_LEVEL, MAX_CONNECT_LEVEL } = require('./config');

function fail(reason) { return { ok: false, reason }; }
function ok(msg) { return { ok: true, msg }; }

// Reject values that are not safe to coerce to a scalar string (objects, arrays).
function isScalar(v) {
  return v == null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
}

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
      if (!isScalar(obj.name) || !isScalar(obj.email)) return fail('name and email must be text');
      const name = String(obj.name == null ? '' : obj.name).trim();
      const email = String(obj.email == null ? '' : obj.email).trim();
      if (!name || !email) return fail('name and email required');
      return ok({ type: 'init', name, email });
    }
    case 'connect': {
      if (obj.level == null || obj.level === '') return fail('level required');
      const level = Number(obj.level);
      if (!Number.isInteger(level) || level < MIN_LEVEL || level > MAX_CONNECT_LEVEL) {
        return fail('level out of range');
      }
      if (!isScalar(obj.password)) return fail('password must be text');
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
      if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols <= 0 || rows <= 0) {
        return fail('bad resize');
      }
      return ok({ type: 'resize', cols, rows });
    }
    default:
      return fail('unknown type');
  }
}

module.exports = { parseClientMessage };
