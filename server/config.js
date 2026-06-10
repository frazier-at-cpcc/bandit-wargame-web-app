'use strict';

module.exports = {
  BANDIT_HOST: 'bandit.labs.overthewire.org',
  BANDIT_PORT: 2220,
  MIN_LEVEL: 0,
  MAX_LEVEL: 24, // highest banditN the app supports; intentional course scope (levels 0-24)
  MAX_CONNECT_LEVEL: 25, // highest banditN the student may connect to (25 finalizes the level-24 PDF)
  HEADER_TEXT: process.env.HEADER_TEXT || 'Introduction to Linux — Bandit',
  // Throttle: min ms between connect attempts per session, and cooldown after a failed login.
  CONNECT_MIN_INTERVAL_MS: 1500,
  FAILED_LOGIN_COOLDOWN_MS: 4000,
  // How long to wait for a connect to prove success/failure before giving up.
  CONNECT_TIMEOUT_MS: 12000,
  // Grace window: if a connect produced output but neither a deny nor the shell
  // prompt was recognized, accept it as connected after this delay.
  CONNECT_GRACE_MS: 2000,
};
