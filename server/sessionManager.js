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

  // Returns { started: true, result: Promise } or { started: false, reason }.
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
          this._promote(proc, level, password);
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
