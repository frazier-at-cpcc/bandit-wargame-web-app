'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { CommandCapture } = require('../server/capture');

test('records a simple command on Enter (CR)', () => {
  const c = new CommandCapture();
  const out = [];
  c.on((line) => out.push(line));
  c.feed('ls\r');
  assert.deepStrictEqual(out, ['ls']);
});

test('treats LF and CRLF as a single submission, ignores empty lines', () => {
  const c = new CommandCapture();
  const out = [];
  c.on((line) => out.push(line));
  c.feed('cat readme\r\n');
  c.feed('\r'); // empty line -> ignored
  assert.deepStrictEqual(out, ['cat readme']);
});

test('applies backspace (0x7f and 0x08)', () => {
  const c = new CommandCapture();
  const out = [];
  c.on((line) => out.push(line));
  c.feed('lx\x7fs\r');          // l, x, backspace, s -> "ls"
  c.feed('cat\x08\x08\x08ls\r'); // cat, 3x backspace, ls -> "ls"
  assert.deepStrictEqual(out, ['ls', 'ls']);
});

test('strips ANSI CSI sequences (e.g. arrow keys)', () => {
  const c = new CommandCapture();
  const out = [];
  c.on((line) => out.push(line));
  c.feed('ls\x1b[D\x1b[C\r'); // left arrow, right arrow embedded
  assert.deepStrictEqual(out, ['ls']);
});

test('Ctrl-C cancels the current line and records nothing', () => {
  const c = new CommandCapture();
  const out = [];
  c.on((line) => out.push(line));
  c.feed('rm -rf /\x03'); // Ctrl-C
  c.feed('ls\r');
  assert.deepStrictEqual(out, ['ls']);
});

test('ignores Tab bytes (completion is server-side, not in keystrokes)', () => {
  const c = new CommandCapture();
  const out = [];
  c.on((line) => out.push(line));
  c.feed('cat re\tadme\r'); // tab ignored; remaining chars kept literally
  assert.deepStrictEqual(out, ['cat readme']);
});

test('feed can be split across chunks', () => {
  const c = new CommandCapture();
  const out = [];
  c.on((line) => out.push(line));
  c.feed('ca');
  c.feed('t read');
  c.feed('me\r');
  assert.deepStrictEqual(out, ['cat readme']);
});

test('ESC at end of chunk does not drop the following CR', () => {
  const c = new CommandCapture();
  const out = [];
  c.on((line) => out.push(line));
  c.feed('ls\x1b');
  c.feed('\r');
  assert.deepStrictEqual(out, ['ls']);
});

test('OSC string sequence (ESC ] ... BEL) does not corrupt the buffer', () => {
  const c = new CommandCapture();
  const out = [];
  c.on((line) => out.push(line));
  c.feed('ls\x1b]0;user@host\x07\r');
  assert.deepStrictEqual(out, ['ls']);
});

test('double-ESC before a CSI sequence leaves no literal bytes in the buffer', () => {
  const c = new CommandCapture();
  const out = [];
  c.on((line) => out.push(line));
  c.feed('ls\x1b\x1b[A\r');
  assert.deepStrictEqual(out, ['ls']);
});
