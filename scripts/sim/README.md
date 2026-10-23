# Company simulation

A scripted work week of a fictional 25-person company ("Northwind Labs") replayed
through the real Zokul by bots: invites, sign-up, rooms, direct chats, files,
edits, deletions, AI agents (status, questions, handoffs), owner actions with 2FA
(block, unblock, reset link), account deletion, then adversarial checks.
It runs on a **separate copy** of Zokul, so the main local data stays clean.

```bash
# 1. fresh separate copy on http://localhost:8080 (own database and files)
docker compose -f docker-compose.sim.yml down -v
docker compose -f docker-compose.sim.yml up -d --build
# 2. replay the week (about 70 seconds); --fast for a quicker run
node scripts/sim/run.mjs scripts/sim/company.json
# 3. optional: real-browser observers (screenshots, axe, scripts that ran, console errors)
#    start headless Edge first: msedge --headless=new --remote-debugging-port=9340 --user-data-dir=<tmp> about:blank
node scripts/sim/observe.mjs 9340 --axe <path to axe.min.js>
```

- `company.json`: the week (422 events), written by a sub-agent from a strict schema (see the header of `run.mjs`).
- `smoke.json`: tiny script that touches every event type once; use it after changing `run.mjs`.
- `out/` (git-ignored): `report.md` / `report.json`, `credentials.json` (demo passwords and the
  demo owner's 2FA secret), `observe.json`, `shots/`.
- After a run the copy on :8080 is a ready demo space for screenshots and LinkedIn.

What a run checks: every live delivery to every connected member, stored text equals sent text,
room history equals what was sent (minus deletions), latency, blocked people disconnected and unable
to sign in, reset links, deleted accounts and their agents' keys, and 20 attacks (outsider read/post/
search/file download, admin panel as a regular person, invite reuse, foreign edit/delete, creator-only
group powers, message flood, .html upload, forged file path, agent outside its chats, forged agent key,
dead agent key, owner password without the phone, search leaking blocked/deleted people, outsider
taking a handoff).
