# Zokul — security audit of version 1.0

Date: 2026-10-22 · Branch: `integrate/foundation` (local) · Reviewed by: Claude Code (Opus 5.5)

## How it was checked

- Reading the entire server code by OWASP vulnerability class: sign-in and sessions, access rights,
  file upload and delivery, XSS, injection, brute force, data leaks, security headers.
- `npm audit` for the server and the client.
- Each finding was confirmed by an attack on a live server (Docker) before and after the fix;
  automated tests were written for the fixes (server 101 tests, client 26 tests).

## Found and fixed

| # | Vulnerability | Risk | Fix |
|---|---|---|---|
| 1 | HTML/JS uploaded disguised as a "voice message": the extension was taken from the file name → script ran on the Zokul origin (stored XSS, session theft) | Critical | Extension taken from the verified MIME type; documents on an allowlist, downloaded as attachments, `CSP: sandbox` |
| 2 | Photos, voice messages, and files were reachable by anyone with a direct link, without signing in | High | Served only to signed-in participants of the chat where the file was sent; avatars — to signed-in users |
| 3 | Registration was open to everyone | High | Invitation only (one-time links, usage limit, expiry, only a hash is stored); the first person is the administrator |
| 4 | Any participant could add/remove people (even in a direct chat), rename, and delete the group | High | Actions only for the creator and only in groups; leaving is available to everyone |
| 5 | Searching a direct chat found the shared group → personal messages (and agents) could end up in the group | High | Search only across direct chats |
| 6 | No security headers on the application page | High | CSP, framing denied, nosniff, Referrer-Policy, Permissions-Policy, HSTS (prod), nginx version hidden |
| 7 | The session check "passed" when the database failed; the socket ignored session revocation | High | Fail-closed; the socket checks the session version; deleted and blocked accounts are disconnected immediately |
| 8 | Password change did not work at all (and did not sign out other sessions) | High | Fixed; a password change ends all other sessions |
| 9 | Links to external images/voice messages/avatars → tracking of readers' IP addresses | Medium | Only the server's own uploads are accepted |
| 10 | Replying to a message from another chat showed its text | Medium | Replies only to messages in the same chat |
| 11 | "Online" status and email were visible to all users of the server | Medium | Status only to people who share a chat; other people's emails are not returned |
| 12 | One could message another user's agent and add it to oneself | Medium | Only the owner can invite their agent |
| 13 | No limits: message length, response size, 6-character passwords, no email validation | Medium | 10,000 characters, no more than 100 messages per request, password 8–72 bytes, email and name validation |
| 14 | JWT without a fixed algorithm; a weak secret was allowed | Medium | HS256 only; in production the server refuses to start with a weak secret |
| 15 | The production database password was hard-coded in `docker-compose.prod.yml` | Medium | Read from `.env`; startup is refused without it |
| 16 | Rate-limit tables in memory grew without bound | Low | Periodic cleanup |
| 17 | Vulnerable dependencies: 10 on the server (1 critical), 5 in the client | — | Updated; unused `uuid` removed; React Router 6 → 7. Result: **0 vulnerabilities** |
| 18 | Fonts were loaded from Google servers (leaking the fact of a visit) | Low | Fonts bundled into the application |

## Added for control

- Administrator panel (`/admin`, admin role only, role re-checked on every request):
  invitations, blocked people, agents, action log, server status.
- Security log: sign-ins, failed sign-ins, registrations, invitations, blocks,
  password changes, agent creation, and issuance of their keys.
- **Admin panel for the owner only, with mandatory two-factor protection** (2026-10-23):
  - The database may contain only one admin — this is a constraint of the database itself; the interface has no "make admin" button.
  - A password alone is not enough: the admin panel opens with a code from an authenticator app on the phone (TOTP standard, RFC 6238).
    Each code works once; 6 wrong codes — a 15-minute pause.
  - 10 backup codes in case the phone is lost, each one-time; only their hashes are stored in the database.
  - After 15 minutes without activity the admin panel closes itself; the "Close admin panel" button closes it immediately.
  - The owner can be changed or 2FA reset only with access to the server:
    `docker compose exec server node dist/scripts/owner.js status | transfer <email> | reset-2fa`.
- **Password reset** — only via a one-time link from the owner (24 hours, only a hash is stored; after the reset the person is signed out
  everywhere). The owner recovers their own password only from the server: `owner.js reset-password`.
- **Account deletion** — initiated by the person themselves, with their password. The data is anonymized, the keys of their agents are deleted, and messages
  remain in chats as "Deleted account".
- `server/scripts/generate-env.mjs` — generates new secrets and push keys for the production server.

## What to know (honestly)

- **This is not end-to-end encryption.** The server owner can technically read the conversations.
  Honest wording: "your own server, sign-in by invitation, data goes nowhere else."
- The push keys in `docker-compose.local.yml` and in the tests are for local development only.
  On the production server — new ones from `generate-env.mjs`.
- `style-src 'unsafe-inline'` in the CSP is kept for React's inline styles; scripts — only our own.
- No independent external audit has been performed; one should be commissioned before a public launch.

## Before deploying to the server

1. `node server/scripts/generate-env.mjs > .env` on the server (not in the repository).
2. HTTPS certificate, header check (`curl -I`), push check on iPhone and Android.
3. Database backup (`scripts/backup-db.sh`) on a schedule.
