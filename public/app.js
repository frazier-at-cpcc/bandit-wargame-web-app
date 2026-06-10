'use strict';

let ws, bridge, sessionId = null;
let currentLevel = 0;
let hasConnected = false;
let identity = { name: '', email: '' };

const FINAL_LEVEL = 25; // connecting here finalizes the level-24 PDF (course complete)

const $ = (id) => document.getElementById(id);

function wsUrl() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}`;
}

function setStatus(text, kind) {
  const s = $('status'); s.textContent = text; s.className = 'status' + (kind ? ' ' + kind : '');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Client-side copy of level task/hints for the panel, fetched from levels.json
// (generated from server/levels.js — the single source of truth).
const LEVELS = {};

async function loadLevels() {
  const res = await fetch('levels.json');
  Object.assign(LEVELS, await res.json());
}

function updateNextBtn() {
  // Show "Next level" only after the student has connected at least once and
  // there is a further level to advance to (cap at the final connect level).
  $('nextLevelBtn').hidden = !(hasConnected && currentLevel < FINAL_LEVEL);
}

function renderLevelPanel(level) {
  if (level >= FINAL_LEVEL) {
    $('levelTitle').textContent = 'Final step — finish the course';
    $('levelTask').textContent =
      'Enter the bandit25 password you discovered in Level 24 and connect to finalize your Level 24 PDF.';
    $('levelHints').innerHTML = '';
    $('pwLabel').firstChild.textContent = 'bandit25 password ';
  } else {
    const meta = LEVELS[level] || { title: '', task: '', hints: [] };
    $('levelTitle').textContent = `Level ${level} → ${level + 1}: ${meta.title}`;
    $('levelTask').textContent = meta.task;
    $('levelHints').innerHTML = meta.hints.map((h) => `<li>${escapeHtml(h)}</li>`).join('');
    $('pwLabel').firstChild.textContent = `bandit${level} password `;
  }
  $('password').value = '';
  $('pdfArea').hidden = true;
  updateNextBtn();
}

function connectWs() {
  ws = new WebSocket(wsUrl());
  ws.onopen = () => { bridge = window.createTerminalBridge('terminal', ws); };
  ws.onmessage = (ev) => handleServer(JSON.parse(ev.data));
  ws.onclose = () => setStatus('Disconnected. Refresh the page to reconnect.', 'err');
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
      hasConnected = true;
      localStorage.setItem('bandit.level', String(currentLevel));
      renderLevelPanel(currentLevel);
      if (currentLevel >= FINAL_LEVEL) {
        setStatus('🎉 Course complete! Download your final Level 24 PDF below.', 'ok');
      } else {
        setStatus(`Connected as bandit${currentLevel}.`, 'ok');
      }
      break;
    case 'levelComplete': {
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
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    setStatus('Not connected. Refresh the page to reconnect.', 'err');
    return;
  }
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
  $('nextLevelBtn').addEventListener('click', () => {
    if (currentLevel < FINAL_LEVEL) {
      currentLevel = currentLevel + 1;
      renderLevelPanel(currentLevel);
      setStatus(`Enter the bandit${currentLevel} password you discovered.`);
    }
  });
});
