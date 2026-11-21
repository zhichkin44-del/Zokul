# Zokul — roadmap for versions 1.0 and 2.0

Approved by the owner on 2026-10-22. Principles: everything is free, code is not published on GitHub,
security matters more than speed, and every part is verified by tests and in live use.

## Chat model (shared by both versions)

One "chat" type, with two kinds of participants: **people** and **agents**.

1. Direct chat with a person.
2. Direct chat with an agent — created together with the agent (already exists).
3. **Project room** — a group of people and agents. It differs only in its settings:
   which agents are allowed, who confirms actions, and how agents react.

## Version 1.0 — "presentable and usable"

### Stage 1. Messenger features — done (2026-10-22)
- "Online within …" (time of the last visit).
- Message search (the server supports it — the interface is needed).
- Files: documents and logs with a size limit and safe delivery.
- Per-chat notification muting.
- Counterpart profile; group management (rename, add/remove a member).
- Agents in project rooms: you can add your own agent to a group; it posts
  statuses, questions, and handoff cards there (reading and discussing them is already part of 2.0).

### Stage 2. Design — done (Paper + warm dark theme, "glass lavender" admin panel)
- Updated interface for "a working tool for people and AI agents".
- Variants are shown to the owner before rollout.

### Stage 3. Security (audit before release) — done, report: docs/SECURITY_AUDIT_V1.md
- Closed registration: sign-in only by invitation.
- Uploaded files and photos — only for chat participants (previously reachable by direct link).
- Security headers (CSP and others), cookies, CORS, request limits, file type checks.
- Secrets only in `.env` on the server, new push keys for the production server.
- `npm audit` and updating vulnerable dependencies; the database is not exposed; backups.
- Result: an audit report listing what was checked.

### Stage 4. Server deployment — postponed by the owner (2026-10-23)
- Free hosting option (to be chosen with the owner), HTTPS.
- Push verification on a real iPhone and Android device.
- Instructions for "how to run Zokul yourself".

### Stage 5. Presentation — postponed by the owner (draft page exists, not published)
- Zokul page on a personal site, README, screenshots, a short video.
- **Surprise:** a separate presentation of version 2.0 (agent swarm) — concept and mockups.

## Version 2.0 — agent swarm (the main feature)

**Prepared to start, waiting for the owner's go-ahead.**

Goal: agents work as a team in a project room, and through role separation and checks
do the work more carefully and safely than a single agent.

- **Roles and personalities:** each bot has a role, a character, a system prompt, and its own set of tools.
- **Narrow scope of responsibility:** a bot may only do what its role allows.
- **Checkpoints:** work proceeds in stages; each stage is checked by a reviewer bot
  and/or confirmed by a person with a button.
- **Agents read the room:** they react to @mentions and to tasks from the shared board.
- **Protection:** turn and cost limits, an emergency stop, protection against endless bot-to-bot conversations,
  an action log, model keys only on the server.
- **Models:** free models via an OpenRouter key (or an equivalent).
- **Demo scenario:** an AI newsroom — a researcher, a writer, an editor, and a fact-checker prepare
  a news post; publication to Telegram happens only after the owner's "Yes".
