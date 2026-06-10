'use strict';

module.exports = {
  BANDIT_HOST: 'bandit.labs.overthewire.org',
  BANDIT_PORT: 2220,
  MIN_LEVEL: 0,
  MAX_LEVEL: 24, // highest banditN the app supports; intentional course scope (levels 0-24)
  HEADER_TEXT: process.env.HEADER_TEXT || 'Introduction to Linux — Bandit',
  // Throttle: min ms between connect attempts per session, and cooldown after a failed login.
  CONNECT_MIN_INTERVAL_MS: 1500,
  FAILED_LOGIN_COOLDOWN_MS: 4000,
  // How long to wait for a connect to prove success/failure before giving up.
  CONNECT_TIMEOUT_MS: 12000,
};
