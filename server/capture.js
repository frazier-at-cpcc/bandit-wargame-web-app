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
