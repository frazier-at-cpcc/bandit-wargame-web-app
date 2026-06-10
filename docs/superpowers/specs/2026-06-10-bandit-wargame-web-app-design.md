# Bandit Wargame Web App — Design Spec

**Date:** 2026-06-10
**Course:** Introduction to Linux — Bandit (RH104, Point)
**Status:** Approved design — ready for implementation planning

---

## 1. Purpose

A web app for a Linux class that lets students work through the OverTheWire **Bandit**
wargame (levels 0 → 24) inside an in-browser terminal that connects to the **real**
Bandit server. As the student works, the app captures every command they type. When a
student completes a level, the app prompts them to download a **formatted per-level PDF**
containing the commands they used, their name/email, and the discovered password (so the
PDF doubles as a resume token).

## 2. Goals & Non-Goals

**Goals**
- Authentic practice: an embedded terminal connected to `bandit.labs.overthewire.org:2220`.
- Automatic, tamper-resistant capture of the commands a student types per level.
- A per-level PDF artifact a student can submit and/or use to resume.
- Force students to **type** commands — paste into the terminal is blocked.
- Deployable on **Render** with no database.

**Non-Goals**
- No stored answer key / no password reveal hints (the app never tells a student a password).
- No self-hosted/simulated Bandit levels — we use the real OverTheWire server.
- No student authentication beyond a name/email entered at session start.
- No durable, server-side progress store (the PDF is the resume mechanism).

## 3. Interaction Model (decided)

- **In-browser terminal → real Bandit.** `xterm.js` ↔ WebSocket ↔ `node-pty` running the
  system `ssh` client against `bandit.labs.overthewire.org:2220`.
- **Student supplies each password; the app only proxies.** The app stores **no** answers.
- **A level is "complete" the instant the student successfully connects to the next level**
  — that login only succeeds with the correct password, so the successful connection *is*
  the verification. A wrong password just surfaces the SSH auth failure; the student stays
  on the current level with their command log still open. **No PDF is produced for an
  unverified level.**
- **No copy/paste into the terminal.** Paste and paste shortcuts are blocked (best-effort
  in a browser; stops casual paste-from-walkthrough). All input is genuinely typed, which
  also makes command capture clean.
- **Levels 0 → 24.** Per-level task + concept hints are shown (never the solution).

## 4. Architecture & Components

Single **Render web service** (Dockerfile-based, Node). No database.

| Component | Responsibility |
|---|---|
| **Frontend (static, served by the app)** | Start screen (name + email), `xterm.js` terminal, level sidebar/progress, per-level task & hint panel, "Connect to next level" control, "Download PDF" button. Blocks paste. |
| **WebSocket gateway** | One socket per active student session. Relays keystrokes → PTY and PTY output → terminal. |
| **Session manager** | Per session holds `{name, email, currentLevel, perLevelCommandLogs}` **in memory**. Spawns/owns the `node-pty` running `ssh -p 2220 banditN@bandit.labs.overthewire.org`. |
| **Command capture** | Buffers inbound keystrokes **server-side**; on Enter, normalizes the line (applies backspaces, strips control sequences) and appends it to the current level's log. Tamper-resistant. |
| **PDF generator** | On demand, renders a per-level PDF (`pdfkit`) from a finished level's log. |

**State & persistence**
- Sessions live **in memory**, keyed by socket.
- The client mirrors `name`, `email`, and `currentLevel` to `localStorage` so a page refresh
  re-establishes the socket and resumes at the right level.
- A mid-class instance restart drops live SSH sessions; the student reconnects and re-enters
  the current level's password. The student's last PDF is their resume token.

**Security boundary**
- The app **only ever connects to one host:port** (`bandit.labs.overthewire.org:2220`) — never
  an arbitrary target — so it is not a general-purpose SSH proxy.

## 5. Data Flow & Level Lifecycle

**Start:** Student enters name + email → stored in session + `localStorage`. App initializes
at **Level 0**.

**Per-level loop (level *N*):**
1. App shows Level *N*'s **task + concept hints** (no solution commands).
2. Student types the **bandit*N* password** into the connect field. (Level 0 is the publicly
   known `bandit0`.) App spawns `ssh … banditN@…` through the PTY.
3. Terminal goes live. Student types commands; **every command line is captured server-side
   into the Level *N* log.**
4. Student finds the next password and clicks **"Connect to next level,"** entering it. App
   opens a fresh PTY as **bandit*(N+1)***.
5. **Successful connection verifies Level *N*.** The app: requires the login to succeed before
   finalizing, closes the old PTY, **finalizes the Level *N* command log**, **captures the
   just-typed password as the discovered password for bandit*(N+1)***, **prompts the per-level
   PDF download**, advances the counter to *N+1*, and loops.

**Consequences**
- The level boundary is unambiguous (next login succeeds ⇒ prior level done).
- A student who can't find a password cannot advance (the pure model). The task/hint panel is
  the only assist; passwords are never revealed by the app.
- Commands run *inside* a level — including level 13's in-session `ssh -i sshkey.private …
  bandit14@localhost` and level 14's `nc localhost 30000` — are just lines in that level's log;
  they execute remotely on OverTheWire, so the app needs no key handling. The app always uses
  **password** auth to `bandit.labs.overthewire.org:2220`.

## 6. Command Capture

Server-side, from the inbound keystroke stream (the client → server → PTY path), so it is
tamper-resistant.

- A "command" = one line submitted to the shell prompt (terminated by Enter).
- Backspaces are applied; control sequences (arrows, Ctrl-C, tab-completion artifacts) are
  normalized out so the log reads as clean commands.
- Captured per level, in order. The app injects nothing — the log is purely what the student
  typed.
- **Known limitation:** keystrokes typed *inside* a full-screen program (e.g. `vi`, `less`)
  can't be cleanly reconstructed as discrete commands. For Bandit 0 → 24 this is rare; such
  lines may appear raw or be filtered. We accept this rather than over-engineer.

## 7. PDF Format

One **per-level** PDF, prompted after each verified level transition.

```
┌─────────────────────────────────────────────┐
│  Introduction to Linux — Bandit              │   ← header (config string)
│  Bandit Wargame — Level N → N+1              │
├─────────────────────────────────────────────┤
│  Student: <name>                             │
│  Email:   <email>                            │
│  Date:    <UTC timestamp>                    │
│  Level:   N → N+1  ("<level title>")         │
├─────────────────────────────────────────────┤
│  Commands used (in order):                   │
│   1  ls                                       │
│   2  cat ./-                                  │
│   3  ...                                       │
├─────────────────────────────────────────────┤
│  Password for bandit(N+1): <discovered pw>   │   ← resume token
│  Commands run: <count>                        │
└─────────────────────────────────────────────┘
```

- Monospace command block; page-breaks for levels with many commands.
- **Includes the discovered password** for bandit*(N+1)* so a student who steps away can
  reconnect to that level later. The password is held in memory transiently (captured at
  verification) and written only into the generated PDF — never to a database.
- **Header text is a config string**, default **"Introduction to Linux — Bandit"**.

## 8. Error Handling & Operational Risks

| Situation | Handling |
|---|---|
| **Wrong password on connect** | SSH auth failure shown in terminal; student stays on current level, no PDF, log stays open. |
| **OverTheWire unreachable / SSH drops mid-level** | Terminal shows the disconnect; student may reconnect to the *same* level (re-entering that level's password). Captured-so-far log preserved in memory. |
| **Page refresh / network blip** | `localStorage` restores name/email/current level; student reconnects and re-enters the current password. |
| **Render instance restart** | In-memory sessions lost; students reconnect (their last PDF is the resume token). |

**Primary operational risk — shared egress IP rate-limiting.** All students connect out
through Render's single outbound IP. OverTheWire runs SSH brute-force/rate protection, so a
full class hammering logins from one IP could get that IP **temporarily throttled or banned**,
blocking everyone. Mitigations (accepted approach — throttle + clear messaging, not a dedicated
egress IP):
- Throttle connection attempts per session; short cooldown after failed logins.
- Surface a clear "the practice server is rate-limiting us, wait a moment" message instead of a
  cryptic failure.
- Document for the instructor as a known constraint; staggering a large class or using a
  paid/dedicated egress helps if it becomes a problem.

## 9. Tech Stack & Deployment

**Stack**
- **Frontend:** static HTML/CSS/JS + `xterm.js` (+ `xterm-addon-fit`, and a thin custom WS
  bridge). Paste blocked via xterm options + intercepting paste events/shortcuts.
- **Backend:** Node + Express (serves static + health) + `ws` (WebSocket) + `node-pty`
  (spawns `ssh`) + `pdfkit` (PDF).
- **No DB.** In-memory session store keyed by socket; client `localStorage` mirror.

**Deployment (Render)**
- **Dockerfile-based web service** (not native runtime): `FROM node:20-slim`,
  `apt-get install -y openssh-client` plus `node-pty` build deps (`python3`, `make`, `g++`),
  `npm ci`, build, start.
- WebSockets are supported natively by Render — no extra config.
- **Recommend at least the Render Starter instance** (the free tier spins down on idle and is
  memory-tight for ~30 concurrent SSH PTYs). Each session ≈ one `ssh` subprocess; size to the
  class roster.
- `render.yaml` blueprint committed for reproducible redeploys.

**Repo shape**
```
/ (Render service root)
  Dockerfile
  render.yaml
  package.json
  /server      app.js, sessionManager.js, captureLine.js, pdf.js, levels.js
  /public      index.html, app.js, terminal.js, styles.css
  /levels      task & hint metadata for levels 0–24
```

`levels.js` / `/levels` holds per-level **task + concept hints** (no solutions). Seed 0 → 15
from the existing `bandit-wargame-notes.md`; author 16 → 24.

## 10. Open Items for Implementation Plan

- Exact WS message protocol (connect-level, keystroke, resize, level-complete, request-PDF).
- Line-normalization rules for the capture buffer (backspace, CR/LF, ANSI control filtering).
- Throttle/cooldown parameters for connection attempts.
- `node-pty` build verification inside the `node:20-slim` image.
