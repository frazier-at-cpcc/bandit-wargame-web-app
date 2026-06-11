'use strict';
const { HEADER_TEXT } = require('./config');
const levels = require('./levels');

// Pure: shape a finalized level into a flat model the renderer can draw.
function buildPdfModel({ session, level, finalized, dateIso }) {
  const meta = levels.getLevel(level);
  const commands = Array.isArray(finalized.commands) ? finalized.commands : [];
  return {
    header: HEADER_TEXT,
    name: session.name,
    email: session.email,
    levelLabel: `Level ${level} → ${level + 1}`,
    title: meta ? meta.title : '',
    date: dateIso,
    commands: commands.slice(),
    commandCount: commands.length,
    nextUser: `bandit${level + 1}`,
    discoveredPassword: finalized.discoveredPassword,
  };
}

module.exports = { buildPdfModel };
