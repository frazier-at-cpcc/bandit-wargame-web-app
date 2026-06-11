'use strict';

// Reconstructs clean command lines from a stream of terminal-input bytes.
// Input-side capture: it sees exactly what the user typed (paste is blocked
// upstream), so reconstruction is reliable for ordinary shell commands.
// Known gaps (accepted in the design): tab-completed text and keystrokes typed
// inside full-screen programs (vi/less) are not reconstructed.

const NORMAL = 0; // accumulating a command line
const ESC = 1;    // saw ESC (0x1b); next byte selects the sequence kind
const CSI = 2;    // inside CSI/SS3: consume until a final byte 0x40-0x7e
const STR = 3;    // inside a string sequence (OSC/DCS/PM/APC/SOS): consume until BEL or ST

class CommandCapture {
  constructor() {
    this._buf = [];           // current line as array of chars
    this._state = NORMAL;
    this._strSawEsc = false;  // in STR: saw an ESC that may begin an ST terminator
    this._listeners = [];
  }

  on(fn) {
    this._listeners.push(fn);
  }

  _emit(line) {
    for (const fn of this._listeners) {
      try { fn(line); } catch (_) { /* isolate one listener's failure from the rest */ }
    }
  }

  _submit() {
    const line = this._buf.join('').trim();
    this._buf = [];
    if (line.length > 0) this._emit(line);
  }

  // Handle a byte as ordinary (non-escape) input.
  _consumeNormal(ch, code) {
    if (code === 0x0d || code === 0x0a) { this._submit(); return; } // CR/LF -> submit
    if (code === 0x7f || code === 0x08) { this._buf.pop(); return; } // DEL/BS
    if (code === 0x03) { this._buf = []; return; }                   // Ctrl-C -> cancel line
    if (code === 0x09) return;                                       // Tab -> ignore
    if (code < 0x20) return;                                         // other control bytes -> ignore
    this._buf.push(ch);
  }

  feed(str) {
    for (const ch of str) {
      const code = ch.codePointAt(0);

      switch (this._state) {
        case ESC:
          // The byte after ESC selects the sequence kind.
          if (ch === '[' || ch === 'O') {
            this._state = CSI;
          } else if (ch === ']' || ch === 'P' || ch === '_' || ch === '^' || ch === 'X') {
            this._state = STR; this._strSawEsc = false;
          } else if (code === 0x1b) {
            this._state = ESC; // ESC ESC -> keep waiting on a fresh selector
          } else {
            // Lone ESC + ordinary byte: drop the ESC, re-process this byte as input
            // (prevents silently swallowing a CR that follows an ESC across a chunk boundary).
            this._state = NORMAL;
            this._consumeNormal(ch, code);
          }
          break;

        case CSI:
          if (code >= 0x40 && code <= 0x7e) this._state = NORMAL; // final byte ends CSI
          break;

        case STR:
          if (this._strSawEsc) {
            this._strSawEsc = false;
            if (ch === '\\') this._state = NORMAL;        // ESC \ = ST, ends the string
            else if (code === 0x1b) this._strSawEsc = true; // another ESC, keep pending
            // else: stay in STR, byte consumed
          } else if (code === 0x07) {
            this._state = NORMAL;                         // BEL ends the string
          } else if (code === 0x1b) {
            this._strSawEsc = true;                       // possible ST terminator start
          }
          break;

        default: // NORMAL
          if (code === 0x1b) { this._state = ESC; break; }
          this._consumeNormal(ch, code);
      }
    }
  }
}

module.exports = { CommandCapture };
