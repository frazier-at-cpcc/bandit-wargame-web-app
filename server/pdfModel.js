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
