'use strict';

// Wraps xterm.js, blocks paste, and bridges keystrokes/output over a WebSocket.
function createTerminalBridge(elementId, ws) {
  const term = new window.Terminal({
    cursorBlink: true, fontFamily: 'Menlo, Consolas, monospace', fontSize: 13,
    theme: { background: '#000000' },
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
  const el = document.getElementById(elementId);
  const blockPaste = (e) => { e.preventDefault(); e.stopPropagation();
    term.writeln('\r\n\x1b[33m[paste is disabled — type the command]\x1b[0m'); };
  el.addEventListener('paste', blockPaste, true);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
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
