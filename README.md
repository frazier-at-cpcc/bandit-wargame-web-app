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

Design complete. See [`docs/superpowers/specs/`](docs/superpowers/specs/) for the full design
spec. Implementation in progress.

## Tech

Node + Express + `ws` + `node-pty` + `pdfkit`; static `xterm.js` frontend. Deploys on
[Render](https://render.com/) via a Dockerfile. No database (in-memory sessions + client
`localStorage`).

## Deployment

Dockerfile-based Render web service. See the spec's *Tech Stack & Deployment* section.
