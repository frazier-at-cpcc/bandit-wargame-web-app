# Bandit Wargame Web App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Render-deployable web app where students run the OverTheWire Bandit wargame (levels 0→24) in an in-browser terminal connected to the real server, with every typed command captured per level and a per-level PDF generated on each verified level transition.

**Architecture:** Node monolith. `xterm.js` browser terminal ↔ WebSocket ↔ `node-pty` running `sshpass`+`ssh` to `bandit.labs.overthewire.org:2220`. Commands are captured **server-side** from the inbound keystroke stream. A level is verified complete when the student successfully connects to the next level. PDFs (`pdfkit`) are served over an HTTP endpoint. No database — sessions live in an in-memory `Map`; the client mirrors name/email/level to `localStorage`. Paste into the terminal is blocked.

**Tech Stack:** Node 20 (CommonJS), Express, `ws`, `node-pty`, `pdfkit`, `sshpass`, `ssh`; static `xterm.js` frontend; tests with built-in `node:test`; deployed via Dockerfile on Render.

---

## File Structure

```
/ (Render service root)
  Dockerfile                 Node 20 image + openssh-client + sshpass + node-pty build deps
  render.yaml                Render blueprint (Dockerfile web service)
  package.json               deps + scripts (start, test)
  .gitignore                 (already present)
  README.md                  (already present)
  server/
    config.js                constants (host, port, level range, header text, throttle params)
    levels.js                level metadata 0-24 (title, task, hints) + lookups. NO solutions.
    capture.js               CommandCapture: keystroke bytes -> clean command lines (pure)
    protocol.js              parse/validate client WS messages (pure)
    pdfModel.js              buildPdfModel(): session+level -> plain model object (pure)
    pdf.js                   renderPdfBuffer(): model -> PDF Buffer (pdfkit)
    sessionManager.js        Session class: state + node-pty spawn + capture wiring
    app.js                   Express + ws wiring; static serving; /pdf endpoint; /healthz
  public/
    index.html               start screen + terminal + level panel markup
    styles.css               layout/styling
    terminal.js              xterm setup, paste blocking, WS bridge
    app.js                   UI state machine (start, connect, level panel, PDF download)
  test/
    capture.test.js
    levels.test.js
    protocol.test.js
    pdfModel.test.js
    pdf.test.js
```

Each `server/*` module has one responsibility. The pure modules (`capture`, `protocol`, `levels`, `pdfModel`) are fully unit-tested. The I/O-bound modules (`sessionManager`, `app`) are built with smoke tests plus manual verification against the real Bandit server (level 0 password is the public string `bandit0`).

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `server/config.js`
- Create: `test/smoke.test.js`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "bandit-wargame-web-app",
  "version": "0.1.0",
  "private": true,
  "description": "In-browser terminal for the OverTheWire Bandit wargame with per-level PDF command logs.",
  "main": "server/app.js",
  "scripts": {
    "start": "node server/app.js",
    "test": "node --test"
  },
  "dependencies": {
    "express": "^4.19.2",
    "ws": "^8.18.0",
    "node-pty": "^1.0.0",
    "pdfkit": "^0.15.0"
  }
}
```

- [ ] **Step 2: Create `server/config.js`**

```js
'use strict';

module.exports = {
  BANDIT_HOST: 'bandit.labs.overthewire.org',
  BANDIT_PORT: 2220,
  MIN_LEVEL: 0,
  MAX_LEVEL: 24, // highest banditN the app supports connecting to
  HEADER_TEXT: process.env.HEADER_TEXT || 'Introduction to Linux — Bandit',
  // Throttle: min ms between connect attempts per session, and cooldown after a failed login.
  CONNECT_MIN_INTERVAL_MS: 1500,
  FAILED_LOGIN_COOLDOWN_MS: 4000,
  // How long to wait for a connect to prove success/failure before giving up.
  CONNECT_TIMEOUT_MS: 12000,
};
```

- [ ] **Step 3: Write a smoke test `test/smoke.test.js`**

```js
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
```

- [ ] **Step 4: Install deps and run the test**

Run: `npm install && npm test`
Expected: install succeeds (node-pty compiles); 1 test passes. If node-pty fails to build locally, that is fine — it is verified in the Docker image in Task 9; comment out the `node-pty` dependency temporarily only if it blocks local pure-logic tests, and restore it before Task 6.

- [ ] **Step 5: Commit**

```bash
git add package.json server/config.js test/smoke.test.js
git commit -m "chore: scaffold project (package.json, config, smoke test)"
```

---

## Task 2: Level metadata module

**Files:**
- Create: `server/levels.js`
- Test: `test/levels.test.js`

- [ ] **Step 1: Write the failing test `test/levels.test.js`**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/levels.test.js`
Expected: FAIL — `Cannot find module '../server/levels'`.

- [ ] **Step 3: Implement `server/levels.js`**

Seed 0–15 from `bandit-wargame-notes.md` (tasks + concepts only, **no commands/answers**). Author 16–24 from the public OverTheWire level descriptions (concepts only). Each entry: `{ level, title, task, hints: [...] }`.

```js
'use strict';

// Task + concept hints ONLY. Never include solution commands or passwords.
const LEVELS = [
  { level: 0, title: 'Log in and read a file',
    task: 'Log in via SSH and read the readme file in the home directory.',
    hints: ['ssh connects you to the server', 'ls lists files', 'cat prints a file'] },
  { level: 1, title: 'A file named -',
    task: 'Read a file whose name is a single dash (-).',
    hints: ['A leading - looks like a command option', 'Reference the file by a path such as ./-'] },
  { level: 2, title: 'Filename with spaces',
    task: 'Read a file whose name contains spaces.',
    hints: ['Quote filenames that contain spaces', 'Tab-completion helps build tricky names'] },
  { level: 3, title: 'A hidden file',
    task: 'Find the password in a hidden file inside the inhere directory.',
    hints: ['Hidden file names start with a dot', 'ls -a reveals hidden entries'] },
  { level: 4, title: 'The only human-readable file',
    task: 'inhere holds many files; only one is ASCII text. Read it.',
    hints: ['file reports content type', 'You can loop over files', 'grep can filter the results'] },
  { level: 5, title: 'Find a file by its properties',
    task: 'In inhere, find the file that is human-readable, exactly 1033 bytes, and not executable.',
    hints: ['find can match by -size (c suffix = bytes)', 'find has an -executable test you can negate'] },
  { level: 6, title: 'Find a file anywhere on the server',
    task: 'Somewhere on the whole filesystem, find a file owned by user bandit7, group bandit6, 33 bytes.',
    hints: ['Search starting from /', 'find supports -user and -group', 'Discard permission errors with 2>/dev/null'] },
  { level: 7, title: 'Find a word in a big file',
    task: 'The password follows the word "millionth" in data.txt.',
    hints: ['grep searches text by pattern'] },
  { level: 8, title: 'The line that appears only once',
    task: 'In data.txt, find the only line that occurs a single time.',
    hints: ['uniq needs adjacent duplicates, so sort first', 'uniq -u prints only unique lines'] },
  { level: 9, title: 'Human-readable strings in binary',
    task: 'The password is one of the few printable strings in data.txt, preceded by several = characters.',
    hints: ['strings extracts printable text', 'Pipe into grep to filter'] },
  { level: 10, title: 'Base64',
    task: 'data.txt is Base64-encoded.',
    hints: ['base64 -d decodes Base64'] },
  { level: 11, title: 'ROT13',
    task: 'data.txt is ROT13-encoded (letters rotated 13 places).',
    hints: ['tr translates character sets', 'ROT13 maps A-M to N-Z and back'] },
  { level: 12, title: 'A repeatedly compressed hexdump',
    task: 'data.txt is a hexdump of a file compressed many times. Reverse the hexdump and decompress repeatedly until plain text.',
    hints: ['Work in a writable dir like /tmp', 'xxd -r reverses a hexdump', 'Identify each layer with file, then gunzip/bunzip2/tar accordingly'] },
  { level: 13, title: 'SSH key instead of a password',
    task: 'There is no password here, only a private key. Use it to log in as bandit14, then read /etc/bandit_pass/bandit14.',
    hints: ['ssh -i keyfile uses public-key auth', 'Every user password is stored in /etc/bandit_pass/<user>'] },
  { level: 14, title: 'Send data to a network port',
    task: 'Submit the bandit14 password to port 30000 on localhost to receive the next password.',
    hints: ['nc (netcat) opens a raw TCP connection', 'Pipe the password into nc'] },
  { level: 15, title: 'Talk to a port over SSL/TLS',
    task: 'Submit the current password to port 30001 on localhost using an SSL/TLS-encrypted connection.',
    hints: ['openssl s_client connects over TLS', 'Use -connect localhost:30001'] },
  { level: 16, title: 'Port scanning + SSL',
    task: 'Find which ports in 31000-32000 speak SSL; one returns a key when you submit the current password. Use it to log in to the next level.',
    hints: ['nmap finds open ports and can probe services', 'openssl s_client speaks to TLS ports', 'The key may be an SSH private key for the next user'] },
  { level: 17, title: 'Differences between two files',
    task: 'In the home directory there are two password files; one line differs between them and that is the new password.',
    hints: ['diff compares two files line by line'] },
  { level: 18, title: 'A modified .bashrc logs you out',
    task: 'The .bashrc logs you out on login. Read readme without an interactive shell.',
    hints: ['ssh can run a single command non-interactively', 'Append the command after the host'] },
  { level: 19, title: 'A setuid binary',
    task: 'Use the provided setuid binary to read the password file for the next user.',
    hints: ['A setuid binary can run commands as another user', 'Run the binary with arguments to execute a command'] },
  { level: 20, title: 'A connect-back setuid binary',
    task: 'A setuid binary connects to a port you listen on; it expects the current password and returns the next one.',
    hints: ['nc can listen on a port (-l -p)', 'Run the listener and the binary together (background one)'] },
  { level: 21, title: 'A cron job',
    task: 'A program scheduled by cron writes the next password to a file. Inspect the cron configuration.',
    hints: ['Look under /etc/cron.d', 'Read the script the cron job runs to find where it writes'] },
  { level: 22, title: 'A cron job with a per-user file',
    task: 'A cron script writes the next password to a file whose name is derived from a username. Read the script.',
    hints: ['Read the cron script under /etc/cron.d', 'Reproduce how it computes the target filename'] },
  { level: 23, title: 'Cron runs your own script',
    task: 'A cron job runs scripts placed in a directory. Place a script that copies the next password somewhere you can read.',
    hints: ['Work in /tmp with a unique directory', 'Make your script readable/executable by the cron user', 'Be patient: cron runs on a schedule'] },
  { level: 24, title: 'Brute-force a 4-digit PIN over a port',
    task: 'A daemon on port 30002 wants the current password plus a secret 4-digit PIN. Try all PINs.',
    hints: ['There are only 10000 PIN combinations', 'A loop can generate every guess', 'Pipe all guesses into nc at once'] },
];

const BY_LEVEL = new Map(LEVELS.map((l) => [l.level, l]));

function getLevel(n) {
  return BY_LEVEL.has(n) ? BY_LEVEL.get(n) : null;
}

function count() {
  return LEVELS.length;
}

function all() {
  return LEVELS.slice();
}

module.exports = { getLevel, count, all };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/levels.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/levels.js test/levels.test.js
git commit -m "feat: add level metadata for bandit 0-24 (tasks/hints, no answers)"
```

---

## Task 3: Command capture (the core unit)

**Files:**
- Create: `server/capture.js`
- Test: `test/capture.test.js`

Captures one clean command line per Enter from the inbound keystroke byte stream. Applies backspaces, strips ANSI escape sequences and stray control bytes, cancels the line on Ctrl-C, ignores Tab.

- [ ] **Step 1: Write the failing test `test/capture.test.js`**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/capture.test.js`
Expected: FAIL — `Cannot find module '../server/capture'`.

- [ ] **Step 3: Implement `server/capture.js`**

```js
'use strict';

// Reconstructs clean command lines from a stream of terminal-input bytes.
// Input-side capture: it sees exactly what the user typed (paste is blocked
// upstream), so reconstruction is reliable for ordinary shell commands.
// Known gaps (accepted in the design): tab-completed text and keystrokes typed
// inside full-screen programs (vi/less) are not reconstructed.
class CommandCapture {
  constructor() {
    this._buf = [];        // current line as array of chars
    this._inEscape = false; // mid ANSI escape sequence
    this._escStarted = false; // saw ESC, deciding sequence type
    this._listeners = [];
  }

  on(fn) {
    this._listeners.push(fn);
  }

  _emit(line) {
    for (const fn of this._listeners) fn(line);
  }

  feed(str) {
    for (const ch of str) {
      const code = ch.codePointAt(0);

      if (this._escStarted) {
        // The char immediately after ESC selects the sequence kind.
        this._escStarted = false;
        if (ch === '[' || ch === 'O') {
          this._inEscape = true; // CSI / SS3: consume until a final byte 0x40-0x7e
        }
        // else: a lone ESC + char; drop both, already consumed.
        continue;
      }

      if (this._inEscape) {
        if (code >= 0x40 && code <= 0x7e) this._inEscape = false; // final byte ends CSI
        continue;
      }

      if (code === 0x1b) {        // ESC
        this._escStarted = true;
        continue;
      }
      if (code === 0x0d || code === 0x0a) { // CR or LF -> submit
        const line = this._buf.join('').trim();
        this._buf = [];
        if (line.length > 0) this._emit(line);
        continue;
      }
      if (code === 0x7f || code === 0x08) { // DEL / BS
        this._buf.pop();
        continue;
      }
      if (code === 0x03) {        // Ctrl-C -> cancel line
        this._buf = [];
        continue;
      }
      if (code === 0x09) continue; // Tab -> ignore
      if (code < 0x20) continue;   // other control bytes -> ignore

      this._buf.push(ch);
    }
  }
}

module.exports = { CommandCapture };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/capture.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add server/capture.js test/capture.test.js
git commit -m "feat: add server-side command capture from keystroke stream"
```

---

## Task 4: WS protocol parser

**Files:**
- Create: `server/protocol.js`
- Test: `test/protocol.test.js`

Validates inbound client messages into a normalized shape, rejecting malformed input.

- [ ] **Step 1: Write the failing test `test/protocol.test.js`**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/protocol.test.js`
Expected: FAIL — `Cannot find module '../server/protocol'`.

- [ ] **Step 3: Implement `server/protocol.js`**

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/protocol.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add server/protocol.js test/protocol.test.js
git commit -m "feat: add WS client message parser/validator"
```

---

## Task 5: PDF model (pure) + renderer

**Files:**
- Create: `server/pdfModel.js`
- Create: `server/pdf.js`
- Test: `test/pdfModel.test.js`
- Test: `test/pdf.test.js`

`buildPdfModel` (pure, fully tested) shapes the data; `renderPdfBuffer` (pdfkit, smoke-tested) draws it.

- [ ] **Step 1: Write the failing test `test/pdfModel.test.js`**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/pdfModel.test.js`
Expected: FAIL — `Cannot find module '../server/pdfModel'`.

- [ ] **Step 3: Implement `server/pdfModel.js`**

```js
'use strict';
const { HEADER_TEXT } = require('./config');
const levels = require('./levels');

// Pure: shape a finalized level into a flat model the renderer can draw.
function buildPdfModel({ session, level, finalized, dateIso }) {
  const meta = levels.getLevel(level);
  return {
    header: HEADER_TEXT,
    name: session.name,
    email: session.email,
    levelLabel: `Level ${level} → ${level + 1}`,
    title: meta ? meta.title : '',
    date: dateIso,
    commands: finalized.commands.slice(),
    commandCount: finalized.commands.length,
    nextUser: `bandit${level + 1}`,
    discoveredPassword: finalized.discoveredPassword,
  };
}

module.exports = { buildPdfModel };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/pdfModel.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the failing renderer smoke test `test/pdf.test.js`**

```js
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
```

- [ ] **Step 6: Run renderer test to verify it fails**

Run: `node --test test/pdf.test.js`
Expected: FAIL — `Cannot find module '../server/pdf'`.

- [ ] **Step 7: Implement `server/pdf.js`**

```js
'use strict';
const PDFDocument = require('pdfkit');

// Draws the model into a PDF and resolves with the full Buffer.
function renderPdfBuffer(model) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 54 });
    const chunks = [];
    doc.on('data', (d) => chunks.push(d));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(16).font('Helvetica-Bold').text(model.header);
    doc.moveDown(0.2);
    doc.fontSize(13).font('Helvetica-Bold')
      .text(`Bandit Wargame — ${model.levelLabel}`);
    doc.moveDown(0.5);

    doc.fontSize(10).font('Helvetica');
    doc.text(`Student: ${model.name}`);
    doc.text(`Email:   ${model.email}`);
    doc.text(`Date:    ${model.date}`);
    doc.text(`Level:   ${model.levelLabel}  ("${model.title}")`);
    doc.moveDown(0.5);

    doc.font('Helvetica-Bold').text('Commands used (in order):');
    doc.moveDown(0.2);
    doc.font('Courier').fontSize(10);
    model.commands.forEach((cmd, i) => {
      doc.text(`${String(i + 1).padStart(3, ' ')}  ${cmd}`);
    });
    if (model.commands.length === 0) {
      doc.font('Helvetica-Oblique').text('(no commands captured)');
    }
    doc.moveDown(0.6);

    doc.font('Helvetica-Bold').fontSize(10)
      .text(`Password for ${model.nextUser}: `, { continued: true })
      .font('Courier').text(model.discoveredPassword || '(not captured)');
    doc.font('Helvetica').text(`Commands run: ${model.commandCount}`);

    doc.end();
  });
}

module.exports = { renderPdfBuffer };
```

- [ ] **Step 8: Run renderer test to verify it passes**

Run: `node --test test/pdf.test.js`
Expected: PASS (1 test).

- [ ] **Step 9: Commit**

```bash
git add server/pdfModel.js server/pdf.js test/pdfModel.test.js test/pdf.test.js
git commit -m "feat: add per-level PDF model and pdfkit renderer"
```

---

## Task 6: Session manager (PTY + ssh + capture wiring)

**Files:**
- Create: `server/sessionManager.js`

This is I/O-bound (spawns processes, talks to the network), so it is built with a structural smoke test plus manual verification against the real server in Task 7/9. The success/failure detection of an SSH connect is heuristic (watch for `Permission denied`, watch for early non-zero exit, otherwise treat as connected after first non-error output).

- [ ] **Step 1: Implement `server/sessionManager.js`**

```js
'use strict';
const crypto = require('crypto');
const pty = require('node-pty');
const { CommandCapture } = require('./capture');
const {
  BANDIT_HOST, BANDIT_PORT, CONNECT_TIMEOUT_MS,
  CONNECT_MIN_INTERVAL_MS, FAILED_LOGIN_COOLDOWN_MS,
} = require('./config');

const DENY_RE = /permission denied|authentication failed/i;

// One Session per connected browser. Holds identity, the live PTY, the current
// level's command log, and finalized per-level logs (with discovered passwords).
class Session {
  constructor() {
    this.id = crypto.randomBytes(12).toString('hex');
    this.name = null;
    this.email = null;
    this.currentLevel = null;     // level of the live PTY
    this.proc = null;             // node-pty process
    this.capture = null;          // CommandCapture for the live level
    this.openCommands = [];       // commands captured for currentLevel so far
    this.finalized = new Map();   // level -> { commands, discoveredPassword }
    this._lastConnectAt = 0;
    this._cooldownUntil = 0;
    this.onData = () => {};        // set by caller: PTY output -> client
  }

  setIdentity(name, email) { this.name = name; this.email = email; }

  // Returns { started: true } or { started: false, reason }.
  connect(level, password) {
    const now = Date.now();
    if (now < this._cooldownUntil) return { started: false, reason: 'cooldown' };
    if (now - this._lastConnectAt < CONNECT_MIN_INTERVAL_MS) {
      return { started: false, reason: 'too-fast' };
    }
    this._lastConnectAt = now;

    const targetUser = `bandit${level}`;
    const args = [
      '-p', password,
      'ssh', '-tt',
      '-p', String(BANDIT_PORT),
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'UserKnownHostsFile=/dev/null',
      '-o', 'PubkeyAuthentication=no',
      `${targetUser}@${BANDIT_HOST}`,
    ];

    const proc = pty.spawn('sshpass', args, {
      name: 'xterm-256color', cols: 80, rows: 24, env: process.env,
    });

    let settled = false;
    let sawOutput = false;

    const finish = (resultLevel, password) => {
      // Promote the new PTY to be the live session for `level`.
      this._promote(proc, level, password);
    };

    const promise = new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (!settled) { settled = true; resolve({ ok: false, reason: 'timeout' }); proc.kill(); }
      }, CONNECT_TIMEOUT_MS);

      proc.onData((data) => {
        this.onData(data); // stream to client regardless
        if (settled) return;
        if (DENY_RE.test(data)) {
          settled = true; clearTimeout(timer);
          this._cooldownUntil = Date.now() + FAILED_LOGIN_COOLDOWN_MS;
          resolve({ ok: false, reason: 'denied' });
          proc.kill();
          return;
        }
        // First substantive output without a deny => treat as connected.
        if (!sawOutput && data.trim().length > 0) {
          sawOutput = true;
          settled = true; clearTimeout(timer);
          finish(level, password);
          resolve({ ok: true });
        }
      });

      proc.onExit(({ exitCode }) => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        this._cooldownUntil = Date.now() + FAILED_LOGIN_COOLDOWN_MS;
        resolve({ ok: false, reason: exitCode === 0 ? 'closed' : 'auth' });
      });
    });

    return { started: true, result: promise };
  }

  // Wire the now-verified PTY as the live level, finalizing the prior level.
  _promote(proc, level, password) {
    // If advancing from currentLevel to currentLevel+1, finalize the prior level.
    if (this.currentLevel !== null && level === this.currentLevel + 1 && this.proc) {
      this.finalized.set(this.currentLevel, {
        commands: this.openCommands.slice(),
        discoveredPassword: password, // the password used to reach `level` (= bandit<level>'s pw)
      });
    }
    // Tear down any previous live PTY.
    if (this.proc && this.proc !== proc) {
      try { this.proc.kill(); } catch (_) {}
    }

    // Reconnect to the SAME level (e.g., after a drop) keeps its open log.
    if (level !== this.currentLevel) this.openCommands = [];

    this.proc = proc;
    this.currentLevel = level;
    this.capture = new CommandCapture();
    this.capture.on((line) => this.openCommands.push(line));
  }

  // Forward a keystroke to the live PTY AND to the capture buffer.
  input(data) {
    if (!this.proc) return;
    this.capture.feed(data);
    this.proc.write(data);
  }

  resize(cols, rows) {
    if (this.proc) { try { this.proc.resize(cols, rows); } catch (_) {} }
  }

  getFinalized(level) {
    return this.finalized.get(level) || null;
  }

  destroy() {
    if (this.proc) { try { this.proc.kill(); } catch (_) {} this.proc = null; }
  }
}

// Process-wide registry so the /pdf HTTP endpoint can find a session by id.
const sessions = new Map();
function createSession() {
  const s = new Session();
  sessions.set(s.id, s);
  return s;
}
function getSession(id) { return sessions.get(id) || null; }
function removeSession(id) {
  const s = sessions.get(id);
  if (s) { s.destroy(); sessions.delete(id); }
}

module.exports = { Session, createSession, getSession, removeSession };
```

- [ ] **Step 2: Sanity-check the module loads (structural smoke)**

Run: `node -e "const m=require('./server/sessionManager'); const s=m.createSession(); s.setIdentity('A','a@x'); console.log('id', !!s.id, 'finalized', m.getSession(s.id)===s); m.removeSession(s.id); console.log('removed', m.getSession(s.id)===null);"`
Expected: prints `id true finalized true` then `removed true`. (No SSH yet — this only verifies wiring/exports. Requires node-pty to be built; if it is not yet building locally, defer this step to run inside the Docker image in Task 9.)

- [ ] **Step 3: Commit**

```bash
git add server/sessionManager.js
git commit -m "feat: add session manager with PTY/ssh spawn and capture wiring"
```

---

## Task 7: Express + WebSocket server

**Files:**
- Create: `server/app.js`

Serves the static frontend, exposes `/healthz` and the `/pdf` download endpoint, and bridges the WebSocket to a `Session`.

- [ ] **Step 1: Implement `server/app.js`**

```js
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');

const { parseClientMessage } = require('./protocol');
const sm = require('./sessionManager');
const { buildPdfModel } = require('./pdfModel');
const { renderPdfBuffer } = require('./pdf');

const app = express();
app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// PDF download for a finalized level: /pdf/:sessionId/:level
app.get('/pdf/:sessionId/:level', async (req, res) => {
  const session = sm.getSession(req.params.sessionId);
  const level = Number(req.params.level);
  if (!session) return res.status(404).send('session not found');
  const finalized = session.getFinalized(level);
  if (!finalized) return res.status(404).send('level not completed');
  const model = buildPdfModel({
    session, level, finalized, dateIso: new Date().toISOString(),
  });
  const buf = await renderPdfBuffer(model);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition',
    `attachment; filename="bandit-level-${level}-${level + 1}.pdf"`);
  res.send(buf);
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  const session = sm.createSession();
  session.onData = (data) => safeSend(ws, { type: 'output', data });

  // Tell the client its session id (needed to build the PDF download URL).
  safeSend(ws, { type: 'ready', sessionId: session.id });

  ws.on('message', async (raw) => {
    const parsed = parseClientMessage(raw.toString());
    if (!parsed.ok) { safeSend(ws, { type: 'error', message: parsed.reason }); return; }
    const msg = parsed.msg;

    if (msg.type === 'init') {
      session.setIdentity(msg.name, msg.email);
      safeSend(ws, { type: 'initialized' });
      return;
    }
    if (msg.type === 'connect') {
      const prevLevel = session.currentLevel;
      const { started, reason, result } = session.connect(msg.level, msg.password);
      if (!started) { safeSend(ws, { type: 'throttled', reason }); return; }
      const r = await result;
      if (!r.ok) { safeSend(ws, { type: 'connectFailed', reason: r.reason }); return; }
      safeSend(ws, { type: 'connected', level: msg.level });
      // If we advanced one level, the prior level is now finalized -> offer PDF.
      if (prevLevel !== null && msg.level === prevLevel + 1) {
        safeSend(ws, { type: 'levelComplete', level: prevLevel });
      }
      return;
    }
    if (msg.type === 'input') { session.input(msg.data); return; }
    if (msg.type === 'resize') { session.resize(msg.cols, msg.rows); return; }
  });

  ws.on('close', () => sm.removeSession(session.id));
});

function safeSend(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`listening on ${PORT}`));

module.exports = { app, server };
```

- [ ] **Step 2: Verify the server boots and serves health**

Run: `PORT=3000 node server/app.js &` then `sleep 1 && curl -s localhost:3000/healthz && echo && kill %1`
Expected: `{"ok":true}`. (If node-pty is not yet built locally, this still boots because the PTY is only spawned on `connect`; defer full run to Docker in Task 9.)

- [ ] **Step 3: Commit**

```bash
git add server/app.js
git commit -m "feat: add express+ws server with PDF download endpoint"
```

---

## Task 8: Frontend (terminal, paste-block, level panel, PDF download)

**Files:**
- Create: `public/index.html`
- Create: `public/styles.css`
- Create: `public/terminal.js`
- Create: `public/app.js`

Loads `xterm.js` from a CDN. Start screen collects name/email; level panel shows task/hints and a connect form; terminal blocks paste; on `levelComplete` a download link to the PDF endpoint appears.

- [ ] **Step 1: Create `public/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Introduction to Linux — Bandit</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.min.css" />
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <header><h1>Introduction to Linux — Bandit</h1></header>

  <section id="start" class="card">
    <h2>Start a session</h2>
    <label>Name <input id="name" type="text" autocomplete="name" /></label>
    <label>Email <input id="email" type="email" autocomplete="email" /></label>
    <button id="startBtn">Start</button>
    <p class="hint">Your name and email appear on each level's PDF.</p>
  </section>

  <main id="workspace" hidden>
    <aside id="panel" class="card">
      <h2 id="levelTitle">Level 0</h2>
      <p id="levelTask"></p>
      <ul id="levelHints"></ul>
      <form id="connectForm">
        <label id="pwLabel">bandit0 password
          <input id="password" type="password" autocomplete="off" />
        </label>
        <button type="submit" id="connectBtn">Connect</button>
      </form>
      <p id="status" class="status"></p>
      <div id="pdfArea" hidden>
        <p>Level complete! Download your command log:</p>
        <a id="pdfLink" href="#" target="_blank" rel="noopener">Download PDF</a>
      </div>
    </aside>
    <div id="terminal"></div>
  </main>

  <script src="https://cdn.jsdelivr.net/npm/xterm@5.3.0/lib/xterm.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/xterm-addon-fit@0.8.0/lib/xterm-addon-fit.min.js"></script>
  <script src="terminal.js"></script>
  <script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `public/styles.css`**

```css
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, sans-serif; background: #0f1117; color: #e6e6e6; }
header { padding: 12px 20px; background: #161a23; border-bottom: 1px solid #2a2f3a; }
header h1 { margin: 0; font-size: 18px; }
.card { background: #161a23; border: 1px solid #2a2f3a; border-radius: 8px; padding: 16px; }
#start { max-width: 420px; margin: 40px auto; }
#start label, #connectForm label { display: block; margin: 10px 0; font-size: 14px; }
#start input, #connectForm input { width: 100%; padding: 8px; margin-top: 4px;
  background: #0f1117; border: 1px solid #2a2f3a; color: #e6e6e6; border-radius: 6px; }
button { padding: 8px 14px; background: #2d6cdf; color: #fff; border: 0; border-radius: 6px; cursor: pointer; }
button:hover { background: #3a7af0; }
.hint { color: #8b93a3; font-size: 12px; }
.status { font-size: 13px; min-height: 18px; }
.status.err { color: #ff6b6b; }
.status.ok { color: #4ec77f; }
main#workspace { display: grid; grid-template-columns: 340px 1fr; gap: 14px; padding: 14px; height: calc(100vh - 55px); }
#panel { overflow-y: auto; }
#panel h2 { margin-top: 0; font-size: 16px; }
#levelHints { padding-left: 18px; color: #b9c0cc; font-size: 13px; }
#terminal { background: #000; border-radius: 8px; padding: 6px; overflow: hidden; }
#pdfArea a { color: #4ec77f; }
```

- [ ] **Step 3: Create `public/terminal.js` (xterm + paste blocking + WS bridge)**

```js
'use strict';

// Wraps xterm.js, blocks paste, and bridges keystrokes/output over a WebSocket.
function createTerminalBridge(elementId, ws) {
  const term = new window.Terminal({
    cursorBlink: true, fontFamily: 'Menlo, Consolas, monospace', fontSize: 13,
    theme: { background: '#000000' },
    // Disable xterm's built-in paste handling.
    disableStdin: false,
  });
  const fit = new window.FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(document.getElementById(elementId));
  fit.fit();
  window.addEventListener('resize', () => {
    fit.fit();
    sendResize();
  });

  // --- Paste blocking ---
  // Block browser paste events on the terminal's textarea + container.
  const el = document.getElementById(elementId);
  const blockPaste = (e) => { e.preventDefault(); e.stopPropagation();
    term.writeln('\r\n\x1b[33m[paste is disabled — type the command]\x1b[0m'); };
  el.addEventListener('paste', blockPaste, true);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  // Intercept Ctrl/Cmd+V and middle-click paste at the key/attach level.
  term.attachCustomKeyEventHandler((ev) => {
    const v = ev.key === 'v' || ev.key === 'V';
    if ((ev.ctrlKey || ev.metaKey) && v) { return false; } // swallow paste shortcut
    return true;
  });

  // Keystrokes -> server (server forwards to PTY and feeds the capture buffer).
  term.onData((data) => ws.send(JSON.stringify({ type: 'input', data })));

  function write(data) { term.write(data); }
  function sendResize() {
    ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
  }

  return { term, write, sendResize, fit: () => fit.fit() };
}

window.createTerminalBridge = createTerminalBridge;
```

- [ ] **Step 4: Create `public/app.js` (UI state machine)**

```js
'use strict';

let ws, bridge, sessionId = null;
let currentLevel = 0;
let identity = { name: '', email: '' };

const $ = (id) => document.getElementById(id);

function wsUrl() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}`;
}

function setStatus(text, kind) {
  const s = $('status'); s.textContent = text; s.className = 'status' + (kind ? ' ' + kind : '');
}

// Client-side copy of level task/hints for the panel, fetched from levels.json
// (generated from server/levels.js — the single source of truth).
const LEVELS = {};

async function loadLevels() {
  const res = await fetch('levels.json');
  Object.assign(LEVELS, await res.json());
}

function renderLevelPanel(level) {
  const meta = LEVELS[level] || { title: '', task: '', hints: [] };
  $('levelTitle').textContent = `Level ${level} → ${level + 1}: ${meta.title}`;
  $('levelTask').textContent = meta.task;
  $('levelHints').innerHTML = meta.hints.map((h) => `<li>${h}</li>`).join('');
  $('pwLabel').firstChild.textContent = `bandit${level} password `;
  $('password').value = '';
  $('pdfArea').hidden = true;
}

function connectWs() {
  ws = new WebSocket(wsUrl());
  ws.onopen = () => { bridge = window.createTerminalBridge('terminal', ws); };
  ws.onmessage = (ev) => handleServer(JSON.parse(ev.data));
  ws.onclose = () => setStatus('Disconnected. Refresh to reconnect.', 'err');
}

function handleServer(msg) {
  switch (msg.type) {
    case 'ready':
      sessionId = msg.sessionId;
      ws.send(JSON.stringify({ type: 'init', name: identity.name, email: identity.email }));
      break;
    case 'initialized':
      bridge.sendResize();
      break;
    case 'output':
      bridge.write(msg.data);
      break;
    case 'connected':
      currentLevel = msg.level;
      localStorage.setItem('bandit.level', String(currentLevel));
      renderLevelPanel(currentLevel);
      setStatus(`Connected as bandit${currentLevel}.`, 'ok');
      break;
    case 'levelComplete': {
      // The completed (prior) level's PDF is now downloadable.
      const link = $('pdfLink');
      link.href = `/pdf/${sessionId}/${msg.level}`;
      link.setAttribute('download', `bandit-level-${msg.level}-${msg.level + 1}.pdf`);
      $('pdfArea').hidden = false;
      break;
    }
    case 'connectFailed':
      setStatus(`Login failed (${msg.reason}). Check the password and try again.`, 'err');
      break;
    case 'throttled':
      setStatus(msg.reason === 'cooldown'
        ? 'The practice server is rate-limiting us — wait a few seconds and retry.'
        : 'Slow down — wait a moment before reconnecting.', 'err');
      break;
    case 'error':
      setStatus(`Error: ${msg.message}`, 'err');
      break;
  }
}

function start() {
  identity.name = $('name').value.trim();
  identity.email = $('email').value.trim();
  if (!identity.name || !identity.email) { alert('Enter name and email.'); return; }
  localStorage.setItem('bandit.name', identity.name);
  localStorage.setItem('bandit.email', identity.email);
  currentLevel = Number(localStorage.getItem('bandit.level') || '0');
  $('start').hidden = true;
  $('workspace').hidden = false;
  renderLevelPanel(currentLevel);
  connectWs();
}

function onConnectSubmit(e) {
  e.preventDefault();
  const password = $('password').value;
  if (!password) { setStatus('Enter the password you found.', 'err'); return; }
  setStatus('Connecting…');
  ws.send(JSON.stringify({ type: 'connect', level: currentLevel, password }));
}

window.addEventListener('DOMContentLoaded', async () => {
  await loadLevels();
  $('name').value = localStorage.getItem('bandit.name') || '';
  $('email').value = localStorage.getItem('bandit.email') || '';
  $('startBtn').addEventListener('click', start);
  $('connectForm').addEventListener('submit', onConnectSubmit);
});
```

Note: the connect form always submits `currentLevel`. To advance, after a level is solved the student increments by re-rendering the next level. Add an explicit "Next level →" affordance:

- [ ] **Step 5: Add a "Next level" control to `public/index.html`**

Insert inside `#pdfArea`, after the PDF link:

```html
      <button id="nextLevelBtn" type="button">Next level →</button>
```

And append to `public/app.js` inside the `DOMContentLoaded` handler:

```js
  $('nextLevelBtn').addEventListener('click', () => {
    currentLevel = currentLevel + 1;
    renderLevelPanel(currentLevel);
    setStatus(`Enter the bandit${currentLevel} password you discovered.`);
  });
```

Clarifying note on the lifecycle: the student connects at level N; solves it; clicks **Next level →** (panel now shows level N+1 and asks for the bandit(N+1) password); enters the discovered password and connects. The successful connect to N+1 makes the server finalize level N and emit `levelComplete` for N, revealing that level's PDF link.

- [ ] **Step 6: Generate the static `public/levels.json` from `server/levels.js`**

Run:
```bash
node -e "const l=require('./server/levels'); const o={}; l.all().forEach(x=>o[x.level]={title:x.title,task:x.task,hints:x.hints}); require('fs').writeFileSync('public/levels.json', JSON.stringify(o,null,2));"
```
Expected: creates `public/levels.json` with entries `0..24`. (This keeps the client panel in sync with the server's single source of truth; re-run whenever `levels.js` changes.)

- [ ] **Step 7: Manual smoke (local, against real Bandit)**

Only if `node-pty`/`sshpass`/`ssh` are available locally (otherwise do this in Task 9 on Render). Run `npm start`, open `http://localhost:3000`, enter a name/email, Start. On the Level 0 panel enter password `bandit0`, Connect. Verify: terminal logs in as bandit0; typing `ls` then `cat readme` works; paste is blocked. Solve level 0, click **Next level →**, enter the bandit1 password, Connect. Verify level 0's **Download PDF** link appears and the PDF lists `ls`, `cat readme`, and `Password for bandit1`.

- [ ] **Step 8: Commit**

```bash
git add public/ server/levels.js
git commit -m "feat: add frontend (terminal, paste-block, level panel, PDF download)"
```

---

## Task 9: Dockerfile, render.yaml, deploy verification

**Files:**
- Create: `Dockerfile`
- Create: `render.yaml`

- [ ] **Step 1: Create `Dockerfile`**

```dockerfile
FROM node:20-slim

# openssh-client (ssh), sshpass (inject password), and node-pty build deps.
RUN apt-get update && apt-get install -y --no-install-recommends \
      openssh-client sshpass python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .

ENV PORT=3000
EXPOSE 3000
CMD ["node", "server/app.js"]
```

- [ ] **Step 2: Create `render.yaml`**

```yaml
services:
  - type: web
    name: bandit-wargame-web-app
    runtime: docker
    plan: starter
    dockerfilePath: ./Dockerfile
    healthCheckPath: /healthz
    envVars:
      - key: HEADER_TEXT
        value: "Introduction to Linux — Bandit"
```

- [ ] **Step 3: Build and run the image locally to verify node-pty compiles and ssh/sshpass exist**

Run:
```bash
docker build -t bandit-web-app . && \
docker run --rm -p 3000:3000 bandit-web-app &
sleep 3 && curl -s localhost:3000/healthz && echo
docker exec "$(docker ps -q --filter ancestor=bandit-web-app)" sh -c 'which ssh sshpass'
```
Expected: `{"ok":true}`, and paths for both `ssh` and `sshpass`. Stop the container afterward.

- [ ] **Step 4: Full end-to-end inside the container (against real Bandit)**

Open `http://localhost:3000`, run the Task 8 Step 7 manual smoke through at least levels 0→2. Confirm command capture, paste blocking, level advancement, and per-level PDF download all work against the real server.

- [ ] **Step 5: Commit and push**

```bash
git add Dockerfile render.yaml
git commit -m "chore: add Dockerfile and Render blueprint"
git push
```

- [ ] **Step 6: Deploy on Render**

In Render: New → Blueprint → connect the GitHub repo `frazier-at-cpcc/bandit-wargame-web-app` → apply. After deploy, open the service URL, run the Step 4 smoke against the live deployment (levels 0→2), confirming PDFs download and the egress reaches OverTheWire.

---

## Task 10: Throttle messaging + final polish

**Files:**
- Modify: `public/app.js` (already handles `throttled`/`connectFailed`)
- Modify: `server/sessionManager.js` (cooldown already applied)

- [ ] **Step 1: Verify rate-limit UX manually**

Trigger a failed login (wrong password) and immediately retry. Expected: the UI shows the cooldown message and a too-fast retry is held off (`CONNECT_MIN_INTERVAL_MS`). Confirm a correct password after the cooldown succeeds.

- [ ] **Step 2: Add a brief instructor note to README**

Append to `README.md`:

```markdown
## Operating for a class

All students share Render's outbound IP, and OverTheWire rate-limits SSH. For a
large class, stagger logins or expect occasional "server is rate-limiting us"
messages. The app throttles connect attempts and applies a short cooldown after a
failed login to stay under the limit.
```

- [ ] **Step 3: Commit and push**

```bash
git add README.md
git commit -m "docs: add instructor note on rate-limiting"
git push
```

---

## Self-Review Notes (addressed)

- **Spec §3 interaction model** → Tasks 6/7/8 (PTY proxy, only-proxy, level-complete on successful next connect).
- **Spec §4 components** → Task 6 (session manager), Task 7 (ws gateway), Task 8 (frontend), in-memory `Map` registry.
- **Spec §5 lifecycle** (no PDF without verified login) → Task 6 `_promote` only runs on `{ ok: true }`; Task 7 emits `levelComplete` only after a successful advance.
- **Spec §6 capture** (server-side, backspace/ANSI/Ctrl-C/Tab handling, known limitations) → Task 3.
- **Spec §7 PDF** (header, identity, commands, discovered password as resume token) → Tasks 5 (model+render) and 7 (endpoint).
- **Spec §8 errors/risks** (wrong password, drop/reconnect same level, refresh via localStorage, restart, rate-limit throttle+messaging) → Tasks 6 (cooldown/reconnect), 8 (localStorage, messaging), 10.
- **Spec §9 stack/deploy** (Dockerfile node:20-slim + openssh-client + sshpass + build deps, render.yaml, Starter plan) → Task 9.
- **Levels 0–24 metadata, no answers** → Task 2 (pedagogy guard test asserts no `solution`/`password` field).
- **No copy/paste** → Task 8 Step 3 (paste event block + Ctrl/Cmd+V swallow + contextmenu disable).
