'use strict';
const crypto = require('crypto');
const pty = require('node-pty');
const { CommandCapture } = require('./capture');
const {
  BANDIT_HOST, BANDIT_PORT, CONNECT_TIMEOUT_MS, CONNECT_GRACE_MS,
  CONNECT_MIN_INTERVAL_MS, FAILED_LOGIN_COOLDOWN_MS,
} = require('./config');

const DENY_RE = /permission denied|authentication failed/i;
const PROMPT_RE = /bandit\d+@bandit:[^\n]*\$/; // the bandit shell prompt
const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]/g;     // strip color codes before matching

// Kill a PTY and stop forwarding its output (so a dying proc can't leak bytes
// to the client after it has been superseded).
function killProc(proc) {
  if (!proc) return;
  try { if (proc._dataSub && proc._dataSub.dispose) proc._dataSub.dispose(); } catch (_) {}
  try { proc.kill(); } catch (_) {}
}

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
    this._connecting = false;     // a connect attempt is in flight
    this.onData = () => {};        // set by caller: PTY output -> client
  }

  setIdentity(name, email) { this.name = name; this.email = email; }

  // Returns { started: true, result: Promise } or { started: false, reason }.
  connect(level, password) {
    const now = Date.now();
    if (this._connecting) return { started: false, reason: 'busy' };
    if (now < this._cooldownUntil) return { started: false, reason: 'cooldown' };
    if (now - this._lastConnectAt < CONNECT_MIN_INTERVAL_MS) {
      return { started: false, reason: 'too-fast' };
    }
    this._lastConnectAt = now;
    this._connecting = true;

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
    let banner = '';
    let timer = null;
    let graceTimer = null;

    const promise = new Promise((resolve) => {
      const settle = (val) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (graceTimer) clearTimeout(graceTimer);
        this._connecting = false;
        resolve(val);
      };

      timer = setTimeout(() => {
        this._cooldownUntil = Date.now() + FAILED_LOGIN_COOLDOWN_MS;
        killProc(proc);
        settle({ ok: false, reason: 'timeout' });
      }, CONNECT_TIMEOUT_MS);

      // Fallback: if output arrived but matched neither a deny nor the shell
      // prompt within a short grace window (prompt-format drift), and the proc
      // is still alive, treat it as connected. Denials arrive fast, so DENY_RE
      // and onExit still win first.
      const armGrace = () => {
        if (graceTimer) return;
        graceTimer = setTimeout(() => {
          this._promote(proc, level, password);
          settle({ ok: true });
        }, CONNECT_GRACE_MS);
      };

      proc._dataSub = proc.onData((data) => {
        this.onData(data); // stream to client while this proc is alive
        if (settled) return;
        banner = (banner + data).slice(-8192);
        const clean = banner.replace(ANSI_RE, '');
        if (DENY_RE.test(clean)) {
          this._cooldownUntil = Date.now() + FAILED_LOGIN_COOLDOWN_MS;
          killProc(proc);
          settle({ ok: false, reason: 'denied' });
          return;
        }
        // Success is anchored to the bandit shell prompt, not merely the first
        // output, so a late "Permission denied" cannot be read as success.
        if (PROMPT_RE.test(clean)) {
          this._promote(proc, level, password);
          settle({ ok: true });
          return;
        }
        if (clean.trim().length > 0) armGrace();
      });

      proc.onExit(({ exitCode }) => {
        if (settled) return;
        this._cooldownUntil = Date.now() + FAILED_LOGIN_COOLDOWN_MS;
        settle({ ok: false, reason: exitCode === 0 ? 'closed' : 'auth' });
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
    // Tear down any previous live PTY (and stop forwarding its output).
    if (this.proc && this.proc !== proc) {
      killProc(this.proc);
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
    if (!this.proc || !this.capture) return;
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
    if (this.proc) { killProc(this.proc); this.proc = null; }
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
