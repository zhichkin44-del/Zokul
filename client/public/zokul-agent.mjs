#!/usr/bin/env node
// Zokul agent tool: lets any AI agent post status, ask you questions and hand
// off work through your Zokul messenger. One file, no dependencies, Node 18+.
//
//   node zokul-agent.mjs connect https://your-zokul zk_...   (once; saves ~/.zokul/config.json)
//   node zokul-agent.mjs <command>        (or pass ZOKUL_URL / ZOKUL_TOKEN env vars)
//
// Commands:
//   status <working|done|failed|info> <text>   post a status line
//   say <text>                                 post a plain message
//   ask <question> [--options A,B] [--wait S]  ask and wait for the answer (default 600 s, 0 = do not wait)
//   answer <question-id> [--wait S]            check / wait for an answer later
//   handoff --title T [--summary S] [--done "a;b"] [--next "a;b"] [--files "a,b"] [--notes N]
//   handoff --json <file|->                    same, from a JSON file or stdin
//   handoffs [--all] [--json]                  list handoffs from your agents
//   claim <handoff-id>                         take a handoff and print it as a prompt
//   connect <url> <token>                      verify and save the connection for this user
//   whoami                                     check the token
//   mcp                                        run as an MCP server over stdio
//
// Exit codes: 0 ok, 1 error, 2 question not answered in time.

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const VERSION = '1.0.0';

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) flags[key] = true;
      else { flags[key] = next; i++; }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

// Saved by `connect` so MCP configs and scripts need no secrets in them.
const CONFIG_FILE = process.env.ZOKUL_CONFIG || join(homedir(), '.zokul', 'config.json');

function savedConfig() {
  try { return JSON.parse(readFileSync(CONFIG_FILE, 'utf8')); } catch { return {}; }
}

function config(flags = {}) {
  const saved = savedConfig();
  const url = (flags.url || process.env.ZOKUL_URL || saved.url || '').replace(/\/+$/, '');
  const token = flags.token || process.env.ZOKUL_TOKEN || saved.token || '';
  if (!url || !token) {
    throw new Error('Not connected. Run: node zokul-agent.mjs connect <zokul-url> <token> (token: Zokul -> AI agents -> Add).');
  }
  return { url, token };
}

async function api(cfg, method, path, body) {
  const res = await fetch(`${cfg.url}/api/agent${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const splitList = (value, sep) =>
  typeof value === 'string' ? value.split(sep).map((s) => s.trim()).filter(Boolean) : Array.isArray(value) ? value : [];

// Long-polls in ≤50 s slices until answered or `totalSeconds` passed.
async function waitForAnswer(cfg, id, totalSeconds) {
  const deadline = Date.now() + totalSeconds * 1000;
  for (;;) {
    const left = Math.ceil((deadline - Date.now()) / 1000);
    const result = await api(cfg, 'GET', `/questions/${id}?wait=${Math.max(0, Math.min(50, left))}`);
    if (result.status === 'answered' || Date.now() >= deadline) return result;
  }
}

function handoffAsPrompt(h) {
  const list = (title, items) => (items && items.length ? `\n${title}:\n${items.map((i) => `- ${i}`).join('\n')}\n` : '');
  return [
    `Continue this work. Handoff: ${h.title}${h.from ? ` (from ${h.from})` : ''}`,
    h.summary ? `\n${h.summary}\n` : '',
    list('Done', h.done),
    list('Next steps', h.next),
    list('Relevant files', h.files),
    h.notes ? `\nNotes:\n${h.notes}\n` : '',
  ].join('').trim();
}

function handoffLine(h) {
  const state = h.claimedBy ? `taken by ${h.claimedBy}` : 'open';
  return `${h.id}  [${state}]  ${h.title}  — from ${h.from}, ${new Date(h.createdAt).toLocaleString()}`;
}

function readJsonInput(source) {
  const raw = source === '-' || source === true ? readFileSync(0, 'utf8') : readFileSync(source, 'utf8');
  return JSON.parse(raw);
}

// ---------------------------------------------------------------- CLI

async function cli(argv) {
  const { positional, flags } = parseArgs(argv);
  const [command, ...rest] = positional;

  if (!command || command === 'help' || flags.help) {
    const lines = readFileSync(new URL(import.meta.url), 'utf8').split(/\r?\n/).slice(1);
    const end = lines.findIndex((l) => !l.startsWith('//'));
    const header = lines.slice(0, end).map((l) => l.replace(/^\/\/ ?/, '')).join('\n');
    console.log(header);
    return 0;
  }
  if (command === 'mcp') {
    await mcpServer(flags);
    return 0;
  }

  if (command === 'connect') {
    const [url, token] = rest;
    if (!url || !token) throw new Error('Usage: connect <zokul-url> <token>');
    const cfg = { url: url.replace(/\/+$/, ''), token };
    const me = await api(cfg, 'GET', '/me');
    mkdirSync(join(CONFIG_FILE, '..'), { recursive: true });
    writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
    try { chmodSync(CONFIG_FILE, 0o600); } catch { /* not supported on Windows */ }
    console.log(`Connected as ${me.name}. Saved to ${CONFIG_FILE}`);
    return 0;
  }

  const cfg = config(flags);
  switch (command) {
    case 'whoami': {
      const me = await api(cfg, 'GET', '/me');
      console.log(`Connected as ${me.name} (${me.id})`);
      return 0;
    }
    case 'status': {
      const [state, ...words] = rest;
      await api(cfg, 'POST', '/status', { state, text: words.join(' ') });
      return 0;
    }
    case 'say': {
      await api(cfg, 'POST', '/messages', { text: rest.join(' ') });
      return 0;
    }
    case 'ask': {
      const options = splitList(flags.options, ',');
      const q = await api(cfg, 'POST', '/questions', { question: rest.join(' '), options });
      const wait = flags.wait === undefined ? 600 : Number(flags.wait);
      if (!wait) { console.log(q.id); return 0; }
      const result = await waitForAnswer(cfg, q.id, wait);
      if (result.status !== 'answered') {
        console.error(`No answer within ${wait}s. Check later: zokul-agent answer ${q.id}`);
        return 2;
      }
      console.log(result.answer);
      return 0;
    }
    case 'answer': {
      const result = await waitForAnswer(cfg, rest[0], Number(flags.wait) || 0);
      if (result.status !== 'answered') { console.error('Not answered yet'); return 2; }
      console.log(result.answer);
      return 0;
    }
    case 'handoff': {
      const body = flags.json ? readJsonInput(flags.json) : {
        title: flags.title,
        summary: flags.summary,
        done: splitList(flags.done, ';'),
        next: splitList(flags.next, ';'),
        files: splitList(flags.files, ','),
        notes: flags.notes,
      };
      const created = await api(cfg, 'POST', '/handoffs', body);
      console.log(created.id);
      return 0;
    }
    case 'handoffs': {
      const list = await api(cfg, 'GET', `/handoffs${flags.all ? '?status=all' : ''}`);
      if (flags.json) console.log(JSON.stringify(list, null, 2));
      else console.log(list.length ? list.map(handoffLine).join('\n') : 'No open handoffs.');
      return 0;
    }
    case 'claim': {
      const h = await api(cfg, 'POST', `/handoffs/${rest[0]}/claim`);
      console.log(handoffAsPrompt(h));
      return 0;
    }
    default:
      console.error(`Unknown command: ${command}. Run with --help.`);
      return 1;
  }
}

// ---------------------------------------------------------------- MCP (stdio)

const TOOLS = [
  {
    name: 'zokul_post_status',
    description: 'Post a short progress update to your human in Zokul (shows on their phone). Use when starting a task, finishing it, or when something failed.',
    inputSchema: {
      type: 'object',
      properties: {
        state: { type: 'string', enum: ['working', 'done', 'failed', 'info'] },
        text: { type: 'string', description: 'One or two sentences.' },
      },
      required: ['state', 'text'],
    },
  },
  {
    name: 'zokul_ask_human',
    description: 'Ask your human a question; they get a push notification and answer from their phone. Waits for the answer up to wait_seconds. If it times out, call zokul_check_answer later instead of asking again.',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string' },
        options: { type: 'array', items: { type: 'string' }, description: 'Up to 6 short answer buttons, e.g. ["Yes","No"]. They can still type a free answer.' },
        wait_seconds: { type: 'number', description: 'How long to wait, default 120, max 900.' },
      },
      required: ['question'],
    },
  },
  {
    name: 'zokul_check_answer',
    description: 'Check (and optionally wait for) the answer to a question asked earlier with zokul_ask_human.',
    inputSchema: {
      type: 'object',
      properties: {
        question_id: { type: 'string' },
        wait_seconds: { type: 'number', description: 'Default 0, max 900.' },
      },
      required: ['question_id'],
    },
  },
  {
    name: 'zokul_create_handoff',
    description: 'Leave a handoff card at the end of a session so the next agent (any vendor) or a person can continue without re-explaining. Be concrete: what was done, what is next, which files matter, gotchas.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        summary: { type: 'string' },
        done: { type: 'array', items: { type: 'string' } },
        next: { type: 'array', items: { type: 'string' } },
        files: { type: 'array', items: { type: 'string' } },
        notes: { type: 'string', description: 'Decisions, gotchas, things not to touch.' },
      },
      required: ['title'],
    },
  },
  {
    name: 'zokul_list_handoffs',
    description: 'List handoff cards left by your human\'s agents. Call this at the start of a session to see if there is work to continue.',
    inputSchema: {
      type: 'object',
      properties: { include_taken: { type: 'boolean', description: 'Also show handoffs already picked up.' } },
    },
  },
  {
    name: 'zokul_claim_handoff',
    description: 'Take a handoff (marks it as picked up by you, visible to your human) and get its full content as instructions.',
    inputSchema: {
      type: 'object',
      properties: { handoff_id: { type: 'string' } },
      required: ['handoff_id'],
    },
  },
  {
    name: 'zokul_send_message',
    description: 'Send a free-form message to your human in Zokul.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  },
];

const INSTRUCTIONS = 'Zokul connects you to your human\'s messenger. At the start of a session call zokul_list_handoffs. '
  + 'Post zokul_post_status when you start and finish meaningful work. When you need a decision, use zokul_ask_human instead of stopping. '
  + 'Before the session ends, leave a zokul_create_handoff. Never put secrets (API keys, passwords) into Zokul messages.';

const clampWait = (value, fallback) => Math.max(0, Math.min(900, Number(value ?? fallback) || 0));

async function callTool(cfg, name, args = {}) {
  switch (name) {
    case 'zokul_post_status':
      await api(cfg, 'POST', '/status', { state: args.state, text: args.text });
      return 'Status posted.';
    case 'zokul_send_message':
      await api(cfg, 'POST', '/messages', { text: args.text });
      return 'Message sent.';
    case 'zokul_ask_human': {
      const q = await api(cfg, 'POST', '/questions', { question: args.question, options: args.options || [] });
      const result = await waitForAnswer(cfg, q.id, clampWait(args.wait_seconds, 120));
      return result.status === 'answered'
        ? `Human answered: ${result.answer}`
        : `No answer yet (question_id: ${q.id}). Continue with other work if you can, then call zokul_check_answer.`;
    }
    case 'zokul_check_answer': {
      const result = await waitForAnswer(cfg, args.question_id, clampWait(args.wait_seconds, 0));
      return result.status === 'answered' ? `Human answered: ${result.answer}` : 'Not answered yet.';
    }
    case 'zokul_create_handoff': {
      const h = await api(cfg, 'POST', '/handoffs', {
        title: args.title, summary: args.summary, done: args.done, next: args.next, files: args.files, notes: args.notes,
      });
      return `Handoff saved (id: ${h.id}). Your human and other agents can see it.`;
    }
    case 'zokul_list_handoffs': {
      const list = await api(cfg, 'GET', `/handoffs${args.include_taken ? '?status=all' : ''}`);
      return list.length ? list.map(handoffLine).join('\n') : 'No open handoffs.';
    }
    case 'zokul_claim_handoff': {
      const h = await api(cfg, 'POST', `/handoffs/${args.handoff_id}/claim`);
      return handoffAsPrompt(h);
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function mcpServer(flags) {
  const cfg = config(flags);
  const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const pending = new Set();

  const handle = async (msg) => {
    const { id, method, params } = msg;
    const reply = (result) => id !== undefined && send({ jsonrpc: '2.0', id, result });
    const fail = (code, message) => id !== undefined && send({ jsonrpc: '2.0', id, error: { code, message } });
    switch (method) {
      case 'initialize':
        return reply({
          protocolVersion: params?.protocolVersion || '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'zokul', version: VERSION },
          instructions: INSTRUCTIONS,
        });
      case 'ping':
        return reply({});
      case 'tools/list':
        return reply({ tools: TOOLS });
      case 'tools/call':
        try {
          const text = await callTool(cfg, params?.name, params?.arguments);
          return reply({ content: [{ type: 'text', text }] });
        } catch (err) {
          return reply({ content: [{ type: 'text', text: `Zokul error: ${err.message}` }], isError: true });
        }
      default:
        if (method?.startsWith('notifications/')) return undefined;
        return fail(-32601, `Method not found: ${method}`);
    }
  };

  rl.on('line', (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
    const p = handle(msg).catch((err) => send({ jsonrpc: '2.0', id: msg.id ?? null, error: { code: -32603, message: err.message } }));
    pending.add(p);
    p.finally(() => pending.delete(p));
  });
  await new Promise((resolve) => rl.on('close', resolve));
  await Promise.all(pending);
}

cli(process.argv.slice(2))
  .then((code) => { process.exitCode = code; })
  .catch((err) => { console.error(`zokul-agent: ${err.message}`); process.exitCode = 1; });
