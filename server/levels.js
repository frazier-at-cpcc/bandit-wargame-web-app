'use strict';

// Task + concept hints ONLY. Never include solution commands or passwords.
const LEVELS = [
  { level: 0, title: 'Log in and read a file',
    task: 'Log in via SSH and read the readme file in the home directory.',
    hints: ['ssh connects you to the server', 'ls lists files', 'cat prints a file'] },
  { level: 1, title: 'A file named -',
    task: 'Read a file whose name is a single dash (-).',
    hints: ['A leading - looks like a command option', 'Reference the file by a path such as ./-'] },
  { level: 2, title: 'Filename with spaces',
    task: 'Read a file whose name contains spaces.',
    hints: ['Quote filenames that contain spaces', 'Tab-completion helps build tricky names'] },
  { level: 3, title: 'A hidden file',
    task: 'Find the password in a hidden file inside the inhere directory.',
    hints: ['Hidden file names start with a dot', 'ls -a reveals hidden entries'] },
  { level: 4, title: 'The only human-readable file',
    task: 'inhere holds many files; only one is ASCII text. Read it.',
    hints: ['file reports content type', 'You can loop over files', 'grep can filter the results'] },
  { level: 5, title: 'Find a file by its properties',
    task: 'In inhere, find the file that is human-readable, exactly 1033 bytes, and not executable.',
    hints: ['find can match by -size (c suffix = bytes)', 'find has an -executable test you can negate'] },
  { level: 6, title: 'Find a file anywhere on the server',
    task: 'Somewhere on the whole filesystem, find a file owned by user bandit7, group bandit6, 33 bytes.',
    hints: ['Search starting from /', 'find supports -user and -group', 'Discard permission errors with 2>/dev/null'] },
  { level: 7, title: 'Find a word in a big file',
    task: 'The password follows the word "millionth" in data.txt.',
    hints: ['grep searches text by pattern'] },
  { level: 8, title: 'The line that appears only once',
    task: 'In data.txt, find the only line that occurs a single time.',
    hints: ['uniq needs adjacent duplicates, so sort first', 'uniq -u prints only unique lines'] },
  { level: 9, title: 'Human-readable strings in binary',
    task: 'The password is one of the few printable strings in data.txt, preceded by several = characters.',
    hints: ['strings extracts printable text', 'Pipe into grep to filter'] },
  { level: 10, title: 'Base64',
    task: 'data.txt is Base64-encoded.',
    hints: ['base64 -d decodes Base64'] },
  { level: 11, title: 'ROT13',
    task: 'data.txt is ROT13-encoded (letters rotated 13 places).',
    hints: ['tr translates character sets', 'ROT13 maps A-M to N-Z and back'] },
  { level: 12, title: 'A repeatedly compressed hexdump',
    task: 'data.txt is a hexdump of a file compressed many times. Reverse the hexdump and decompress repeatedly until plain text.',
    hints: ['Work in a writable dir like /tmp', 'xxd -r reverses a hexdump', 'Identify each layer with file, then gunzip/bunzip2/tar accordingly'] },
  { level: 13, title: 'SSH key instead of a password',
    task: 'There is no password here, only a private key. Use it to log in as bandit14, then read /etc/bandit_pass/bandit14.',
    hints: ['ssh -i keyfile uses public-key auth', 'Every user password is stored in /etc/bandit_pass/<user>'] },
  { level: 14, title: 'Send data to a network port',
    task: 'Submit the bandit14 password to port 30000 on localhost to receive the next password.',
    hints: ['nc (netcat) opens a raw TCP connection', 'Pipe the password into nc'] },
  { level: 15, title: 'Talk to a port over SSL/TLS',
    task: 'Submit the current password to port 30001 on localhost using an SSL/TLS-encrypted connection.',
    hints: ['openssl s_client connects over TLS', 'Use -connect localhost:30001'] },
  { level: 16, title: 'Port scanning + SSL',
    task: 'Find which ports in 31000-32000 speak SSL; one returns a key when you submit the current password. Use it to log in to the next level.',
    hints: ['nmap finds open ports and can probe services', 'openssl s_client speaks to TLS ports', 'The key may be an SSH private key for the next user'] },
  { level: 17, title: 'Differences between two files',
    task: 'In the home directory there are two password files; one line differs between them and that is the new password.',
    hints: ['diff compares two files line by line'] },
  { level: 18, title: 'A modified .bashrc logs you out',
    task: 'The .bashrc logs you out on login. Read readme without an interactive shell.',
    hints: ['ssh can run a single command non-interactively', 'Append the command after the host'] },
  { level: 19, title: 'A setuid binary',
    task: 'Use the provided setuid binary to read the password file for the next user.',
    hints: ['A setuid binary can run commands as another user', 'Run the binary with arguments to execute a command'] },
  { level: 20, title: 'A connect-back setuid binary',
    task: 'A setuid binary connects to a port you listen on; it expects the current password and returns the next one.',
    hints: ['nc can listen on a port (-l -p)', 'Run the listener and the binary together (background one)'] },
  { level: 21, title: 'A cron job',
    task: 'A program scheduled by cron writes the next password to a file. Inspect the cron configuration.',
    hints: ['Look under /etc/cron.d', 'Read the script the cron job runs to find where it writes'] },
  { level: 22, title: 'A cron job with a per-user file',
    task: 'A cron script writes the next password to a file whose name is derived from a username. Read the script.',
    hints: ['Read the cron script under /etc/cron.d', 'Reproduce how it computes the target filename'] },
  { level: 23, title: 'Cron runs your own script',
    task: 'A cron job runs scripts placed in a directory. Place a script that copies the next password somewhere you can read.',
    hints: ['Work in /tmp with a unique directory', 'Make your script readable/executable by the cron user', 'Be patient: cron runs on a schedule'] },
  { level: 24, title: 'Brute-force a 4-digit PIN over a port',
    task: 'A daemon on port 30002 wants the current password plus a secret 4-digit PIN. Try all PINs.',
    hints: ['There are only 10000 PIN combinations', 'A loop can generate every guess', 'Pipe all guesses into nc at once'] },
];

const BY_LEVEL = new Map(LEVELS.map((l) => [l.level, l]));

if (BY_LEVEL.size !== LEVELS.length) {
  throw new Error('levels.js: duplicate level numbers detected');
}

function getLevel(n) {
  const key = Number(n);
  return BY_LEVEL.has(key) ? BY_LEVEL.get(key) : null;
}

function count() {
  return LEVELS.length;
}

function all() {
  return LEVELS.slice();
}

module.exports = { getLevel, count, all };
