<h1 align="center">Zokul</h1>

<p align="center">
  <strong>Mobile-first realtime messenger built as a full-stack production-ready web app.</strong>
</p>

<p align="center">
  <a href="https://zokul.example.com">Live Demo</a>
  ·
  <a href="#features">Features</a>
  ·
  <a href="#architecture">Architecture</a>
  ·
  <a href="#local-development">Local Development</a>
  ·
  <a href="#documentation">Documentation</a>
</p>

<p align="center">
  <img alt="React" src="https://img.shields.io/badge/React-18-149ECA?logo=react&logoColor=white">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white">
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-Express-339933?logo=nodedotjs&logoColor=white">
  <img alt="Socket.IO" src="https://img.shields.io/badge/Socket.IO-Realtime-010101?logo=socketdotio&logoColor=white">
  <img alt="PostgreSQL" src="https://img.shields.io/badge/PostgreSQL-Database-4169E1?logo=postgresql&logoColor=white">
  <img alt="Docker" src="https://img.shields.io/badge/Docker-Deployable-2496ED?logo=docker&logoColor=white">
</p>

<p align="center">
  <img src="docs/assets/screenshots/chat-dark.png" alt="Zokul messenger chat interface" width="960">
</p>

## Overview

Zokul is a realtime web messenger with a clean dark interface, responsive layout, voice messages, media sharing, online presence, and Docker-based deployment.

The project is designed as a real product rather than a UI prototype: it has a client, API server, database, realtime transport, file uploads, production compose files, release scripts, tests, and project documentation for AI-assisted development.

## Features

- Realtime private and group chats powered by Socket.IO.
- Text messages, image attachments, multiple image upload, replies, editing, and deletion.
- Voice messages with browser recording and audio playback.
- Online status, typing states, and message delivery/read-state foundation.
- User profile editing with avatar upload.
- Dark and soft-light themes.
- Mobile-first responsive messenger layout.
- PWA-ready frontend for app-like browser usage.
- AI agent hub: agents post status, ask questions you answer from your phone, and hand off work to each other (MCP + CLI).
- Rate limiting, validation, authentication, and production-oriented server configuration.
- Docker Compose environments for local and production checks.

## Screenshots

### Chat Experience

<p align="center">
  <img src="docs/assets/screenshots/chat-dark.png" alt="Zokul dark chat screen" width="920">
</p>

### Authentication

<p align="center">
  <img src="docs/assets/screenshots/login.png" alt="Zokul login screen" width="920">
</p>

## AI Agents

Zokul is also a hub for AI coding agents. Any agent (Claude Code, Codex, Cursor, Gemini CLI, Qwen/DeepSeek/Kimi CLIs or a plain script) can:

- **post status**: "working on X", "done", "failed: build error";
- **ask you a question** with answer buttons: you get a push notification and answer from your phone, and the agent continues;
- **leave a handoff card** at the end of a session (done / next / files / notes) that the next agent or a person picks up, so nobody re-explains the project.

Each agent is a chat participant with its own token (only a SHA-256 hash is stored). Create one in the app: **AI agents → Add**. Then connect it with the single-file tool the server hosts at `/zokul-agent.mjs` (Node 18+, no dependencies):

```bash
curl -fsSL https://your-zokul/zokul-agent.mjs -o zokul-agent.mjs
node zokul-agent.mjs connect https://your-zokul zk_...   # once: saves ~/.zokul/config.json, so no secrets in configs

# As an MCP server (Claude Code shown; any MCP client works)
claude mcp add zokul -- node /path/to/zokul-agent.mjs mcp

# As a CLI from any agent, hook or script (ZOKUL_URL / ZOKUL_TOKEN env vars also work)
node zokul-agent.mjs status working "Refactoring push notifications"
node zokul-agent.mjs ask "Delete old migrations?" --options Yes,No   # prints the answer, exit 2 on timeout
node zokul-agent.mjs handoff --title "Push on iPhone" --done "sw.pwa.ts;enable button" --next "test over HTTPS"
node zokul-agent.mjs handoffs
node zokul-agent.mjs claim <handoff-id>                              # prints the handoff as a prompt
```

MCP tools: `zokul_post_status`, `zokul_ask_human`, `zokul_check_answer`, `zokul_create_handoff`, `zokul_list_handoffs`, `zokul_claim_handoff`, `zokul_send_message`.

Agent REST API (`Authorization: Bearer zk_...`): `GET /api/agent/me`, `POST /api/agent/status`, `POST /api/agent/messages`, `POST /api/agent/questions`, `GET /api/agent/questions/:id?wait=50` (long-poll), `POST /api/agent/handoffs`, `GET /api/agent/handoffs[?status=all]`, `POST /api/agent/handoffs/:id/claim`.

## Architecture

```mermaid
flowchart LR
  User["Browser / PWA"] --> Client["React + TypeScript client"]
  Client --> API["Express REST API"]
  Client <-->|"Socket.IO events"| Realtime["Socket.IO server"]
  API --> DB["PostgreSQL"]
  Realtime --> DB
  API --> Uploads["Local upload storage"]
  API --> Redis["Redis / rate-limit support"]
  Nginx["Nginx / production reverse proxy"] --> Client
  Nginx --> API
```

## Tech Stack

| Layer | Technology |
| --- | --- |
| Frontend | React, TypeScript, Vite, PWA |
| Realtime | Socket.IO |
| Backend | Node.js, Express |
| Database | PostgreSQL |
| Cache / limits | Redis |
| Storage | Local uploads volume |
| Deployment | Docker, Docker Compose, Nginx |
| Quality | Unit/integration tests, release scripts, project protocol docs |

## Local Development

Install dependencies:

```bash
npm install
npm install --prefix client
npm install --prefix server
```

Run the client and server in development mode:

```bash
npm run dev
```

Run tests:

```bash
npm test
```

Build the project:

```bash
npm run build
```

## Docker Check

Run the local Docker environment:

```bash
docker compose -f docker-compose.local.yml up -d --build
```

Open:

```text
http://localhost
```

Stop containers:

```bash
docker compose -f docker-compose.local.yml down
```

## Production Deployment

Production deployment is prepared through the dedicated production branch and compose file.

```bash
git checkout production
docker compose -f docker-compose.prod.yml up -d --build
```

For a clean production start, use the release script only when you intentionally want to remove runtime data:

```bash
powershell -ExecutionPolicy Bypass -File scripts/prepare-release.ps1 -FreshServerData
```

Secrets, certificates, and runtime `.env` files are not stored in the repository.

## Documentation

The repository includes a project documentation protocol in [`docs/`](docs/). It is used to keep architecture, decisions, task handoffs, project state, and AI-agent work logs consistent.

Useful entry points:

- [`docs/00_README_FOR_AGENTS.md`](docs/00_README_FOR_AGENTS.md) - how agents should navigate and maintain the project documentation.
- [`docs/CONTROL_PLANE.md`](docs/CONTROL_PLANE.md) - current project state and operational control panel.
- [`docs/PROJECT_MAP.md`](docs/PROJECT_MAP.md) - architecture and module map.
- [`docs/tasks/active/NEXT_AGENT_TASK.md`](docs/tasks/active/NEXT_AGENT_TASK.md) - current implementation handoff, when active.

## Repository Model

- `master` - main source branch with code and documentation.
- `production` - deployable branch for server updates.

The project keeps generated artifacts, runtime uploads, local reports, and secrets out of Git.

## Roadmap

- Improve read receipts and message state clarity.
- Add user profile viewing for chat participants.
- Expand group chat controls.
- Add an admin panel for moderation and operational visibility.
- Continue strengthening automated tests around realtime and media flows.

## Project Status

Zokul is actively developed as a portfolio-grade full-stack messenger. The current focus is product polish, stable deployment, clean documentation, and a workflow where planning and implementation can be safely split between different AI agents.
