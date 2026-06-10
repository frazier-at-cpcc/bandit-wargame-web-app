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
