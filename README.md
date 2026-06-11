# Bandit Wargame Web App

A web app for the **Introduction to Linux — Bandit** course. Students work through the
[OverTheWire Bandit](https://overthewire.org/wargames/bandit/) wargame (levels 0 → 24) inside
an in-browser terminal connected to the **real** Bandit server. The app captures every command
a student types and, after each completed level, prompts them to download a formatted PDF of
the commands they used, their name/email, and the discovered password (so the PDF doubles as a
resume token).

## How it works

- **In-browser terminal → real Bandit.** `xterm.js` ↔ WebSocket ↔ `node-pty` running `ssh`
  against `bandit.labs.overthewire.org:2220`.
- **The app only proxies — it stores no answer passwords.** A level is complete the instant the
  student successfully connects to the next level (that login only works with the right
  password, so the connection *is* the verification).
- **No copy/paste into the terminal** — students must type every command.
- **Per-level PDF** is generated on each verified level transition.

## Status

Implemented — backend and frontend complete, 35 tests passing. Deploy via the Render blueprint (`render.yaml`). See [`docs/superpowers/specs/`](docs/superpowers/specs/) for the full design spec.

## Tech

Node + Express + `ws` + `node-pty` + `pdfkit`; static `xterm.js` frontend. Deploys on
[Render](https://render.com/) via a Dockerfile. No database (in-memory sessions + client
`localStorage`).

## Deployment

Dockerfile-based Render web service. See the spec's *Tech Stack & Deployment* section.

## Operating for a class

All students share Render's outbound IP, and OverTheWire rate-limits SSH. For a
large class, stagger logins or expect occasional "server is rate-limiting us"
messages. The app throttles connect attempts and applies a short cooldown after a
failed login to stay under the limit. If the shared IP gets temporarily blocked,
wait a few minutes or use a paid/dedicated egress.

### How a student uses it

1. Open the app and enter your name and email (these appear on every PDF).
2. On the Level 0 panel, type the `bandit0` password and click **Connect**.
3. Solve the level in the terminal. Copy/paste is disabled — type every command.
4. When you find the next password, click **Next level →**, type that password,
   and **Connect**. A successful connection verifies the level and reveals a
   **Download PDF** of the commands you used (and the discovered password, so the
   PDF doubles as a resume token).
5. Repeat through Level 24. The final step connects you as `bandit25`, which
   finalizes your Level 24 PDF and shows "Course complete".

### Deploy

This repo includes a `render.yaml` blueprint. In Render: **New → Blueprint**,
connect this GitHub repo, and apply. The service builds from the `Dockerfile`
(Node 20 + `openssh-client` + `sshpass`) and serves on the port Render provides.
Set `HEADER_TEXT` to change the PDF header (defaults to "Introduction to Linux —
Bandit").
