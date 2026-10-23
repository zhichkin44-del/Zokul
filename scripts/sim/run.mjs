// Replays a scripted company work week through the real Zokul (REST + Socket.IO),
// exactly like 25 people and their AI agents would, then checks delivery,
// consistency and latency, and writes a report.
//
//   docker compose -f docker-compose.sim.yml up -d --build      # fresh, separate Zokul on :8080
//   node scripts/sim/run.mjs scripts/sim/company.json [--base http://localhost:8080] [--fast]
//
// Output (git-ignored): scripts/sim/out/credentials.json (demo passwords + owner 2FA secret),
// scripts/sim/out/report.json and report.md.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, '../../client/package.json'));
const { io } = require('socket.io-client');

const args = process.argv.slice(2);
const scriptFile = args.find((a) => !a.startsWith('--')) ?? join(here, 'company.json');
const BASE = args.includes('--base') ? args[args.indexOf('--base') + 1] : 'http://localhost:8080';
const PACE = args.includes('--fast') ? 15 : 120; // ms between events
const OUT = join(here, 'out');
mkdirSync(OUT, { recursive: true });
const script = JSON.parse(readFileSync(scriptFile, 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- report ----------
const report = { startedAt: new Date().toISOString(), base: BASE, counts: {}, problems: [], latencies: [], notes: [], attacks: [], perDay: [] };
const count = (k) => { report.counts[k] = (report.counts[k] ?? 0) + 1; };
const problem = (where, what, extra) => { report.problems.push({ where, what, ...(extra ? { extra } : {}) }); console.log(`  ✗ ${where}: ${what}${extra ? ' ' + JSON.stringify(extra).slice(0, 200) : ''}`); };

// ---------- http ----------
function session() {
  const cookies = {};
  const call = async (path, { method = 'GET', body, form, bearer } = {}) => {
    const headers = { cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ') };
    if (bearer) headers.authorization = `Bearer ${bearer}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(BASE + '/api' + path, { method, headers, body: form ?? (body !== undefined ? JSON.stringify(body) : undefined) });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';'); const i = kv.indexOf('=');
      if (kv.slice(i + 1) === '') delete cookies[kv.slice(0, i)]; else cookies[kv.slice(0, i)] = kv.slice(i + 1);
    }
    let data = null; try { data = await res.json(); } catch { /* empty */ }
    return { status: res.status, data };
  };
  call.cookies = cookies;
  return call;
}
const ok = (r, where, expect = [200, 201, 204]) => { if (!expect.includes(r.status)) problem(where, `HTTP ${r.status}`, r.data); return expect.includes(r.status); };

// ---------- totp (owner 2FA) ----------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function totp(secret, offset = 0) {
  let bits = 0, value = 0; const key = [];
  for (const ch of secret) { value = (value << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { key.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offset));
  const h = crypto.createHmac('sha1', Buffer.from(key)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0');
}

// ---------- state ----------
const people = new Map();   // key -> { key, name, email, password, id, http, socket, received:Set, blocked, deleted }
const agents = new Map();   // key -> { key, name, owner, id, token, dmChatId }
const rooms = new Map();    // key -> { key, chatId, creator, members:Set(personKeys), agents:Set }
const dms = new Map();      // "a|b" -> chatId
const msgIds = new Map();   // event id -> { messageId, chatId, from }
const sent = [];            // { messageId, chatId, expected:[personKeys], at }
const password = () => crypto.randomBytes(9).toString('base64url');

function connect(p) {
  return new Promise((resolve) => {
    const s = io(BASE, { transports: ['websocket'], extraHeaders: { cookie: `token=${p.http.cookies.token}` }, reconnection: false });
    p.socket = s;
    p.errors = [];
    s.on('message:new', (m) => { p.received.add(m.id); const w = p.waiting?.get(m.id) ?? p.waitingText?.get(m.text); if (w) w(m); });
    s.on('error', (e) => { p.errors.push(e?.message ?? String(e)); p.onError?.(e?.message ?? String(e)); });
    s.on('connect', () => resolve(true));
    s.on('connect_error', (e) => { problem(`socket ${p.key}`, e.message); resolve(false); });
  });
}

// Sends over the socket and waits for the server's echo (or an error).
function sendMessage(p, chatId, payload) {
  return new Promise((resolve) => {
    const nonce = `${payload.text ?? ''}`;
    const t0 = performance.now();
    const timer = setTimeout(() => { cleanup(); resolve({ error: 'timeout' }); }, 5000);
    p.waitingText = new Map([[nonce, (m) => { cleanup(); resolve({ message: m, ms: performance.now() - t0 }); }]]);
    p.onError = (e) => { cleanup(); resolve({ error: e }); };
    const cleanup = () => { clearTimeout(timer); p.waitingText = null; p.onError = null; };
    p.socket.emit('message:send', { chatId, ...payload });
  });
}
function emitAndWaitError(p, event, data, ms = 600) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { p.onError = null; resolve(null); }, ms);
    p.onError = (e) => { clearTimeout(timer); p.onError = null; resolve(e); };
    p.socket.emit(event, data);
  });
}

function chatOf(from, to) {
  if (to.startsWith('room:')) return rooms.get(to.slice(5))?.chatId;
  const other = to.slice(3);
  return dms.get([from, other].sort().join('|'));
}
function membersOf(from, to) {
  if (to.startsWith('room:')) return [...(rooms.get(to.slice(5))?.members ?? [])];
  return [from, to.slice(3)].filter((k) => people.has(k));
}
async function ensureDm(fromKey, toKey) {
  const id = [fromKey, toKey].sort().join('|');
  if (dms.has(id)) return dms.get(id);
  const from = people.get(fromKey), to = people.get(toKey);
  const r = await from.http('/chats', { method: 'POST', body: { participantId: to.id } });
  if (!ok(r, `open DM ${fromKey}->${toKey}`)) return null;
  dms.set(id, r.data.id);
  count('dm opened');
  return r.data.id;
}

// ---------- setup ----------
async function setup() {
  const [ownerDef, ...rest] = script.people;
  console.log(`Setting up ${script.people.length} people, ${script.agents.length} agents, ${script.rooms.length} rooms on ${BASE}`);
  const health = await fetch(BASE + '/api/health').then((r) => r.status).catch(() => 0);
  if (health !== 200) throw new Error(`Zokul is not reachable at ${BASE} (health ${health})`);

  // The first person on a fresh server becomes its owner; 2FA is mandatory for the panel.
  const owner = { ...ownerDef, password: password(), http: session(), received: new Set() };
  let r = await owner.http('/auth/register', { method: 'POST', body: { email: owner.email, password: owner.password, name: owner.name } });
  if (r.status !== 201) throw new Error(`Owner registration failed (${r.status} ${JSON.stringify(r.data)}). Is this a fresh sim database?`);
  owner.id = r.data.user.id;
  if (r.data.user.role !== 'admin') problem('owner', 'first person did not become the owner', r.data.user);
  people.set(owner.key, owner);
  r = await owner.http('/admin/2fa/setup', { method: 'POST' });
  owner.totpSecret = r.data?.secret;
  r = await owner.http('/admin/2fa/enable', { method: 'POST', body: { code: totp(owner.totpSecret) } });
  if (!ok(r, 'owner 2FA enable')) throw new Error('2FA setup failed');
  owner.recoveryCodes = r.data.recoveryCodes;

  // Everyone else joins with a personal invite.
  for (const def of rest) {
    const inv = await owner.http('/admin/invites', { method: 'POST', body: { label: def.name, maxUses: 1, expiresInDays: 7 } });
    if (!ok(inv, `invite for ${def.key}`)) continue;
    const p = { ...def, password: password(), http: session(), received: new Set() };
    const reg = await p.http('/auth/register', { method: 'POST', body: { email: p.email, password: p.password, name: p.name, inviteCode: inv.data.code } });
    if (!ok(reg, `register ${def.key}`)) continue;
    p.id = reg.data.user.id;
    p.inviteCode = inv.data.code;
    people.set(p.key, p);
    count('person joined');
  }
  for (const p of people.values()) await connect(p);
  console.log(`  ${[...people.values()].filter((p) => p.socket?.connected).length} sockets connected`);

  for (const a of script.agents) {
    const owner = people.get(a.owner);
    const res = await owner.http('/agents', { method: 'POST', body: { name: a.name } });
    if (!ok(res, `agent ${a.key}`)) continue;
    agents.set(a.key, { ...a, id: res.data.agent.id, token: res.data.token, dmChatId: res.data.chatId });
    count('agent created');
  }

  for (const room of script.rooms) {
    const creator = people.get(room.creator);
    const memberIds = room.members.filter((k) => k !== room.creator).map((k) => people.get(k)?.id).filter(Boolean);
    const res = await creator.http('/chats/group', { method: 'POST', body: { name: room.name, participantIds: memberIds } });
    if (!ok(res, `room ${room.key}`)) continue;
    const entry = { key: room.key, chatId: res.data.id, creator: room.creator, members: new Set(room.members), agents: new Set() };
    rooms.set(room.key, entry);
    for (const ak of room.agents ?? []) {
      const agent = agents.get(ak);
      const owner = people.get(agent.owner);
      const add = await owner.http(`/chats/${entry.chatId}/members`, { method: 'POST', body: { userId: agent.id } });
      if (ok(add, `add agent ${ak} to ${room.key}`)) entry.agents.add(ak);
    }
    count('room created');
  }
}

// ---------- events ----------
const agentCall = (agent, path, body) => fetch(BASE + '/api/agent' + path, {
  method: 'POST', headers: { authorization: `Bearer ${agent.token}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
}).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }));

function agentChat(agent, to) {
  if (to.startsWith('room:')) return rooms.get(to.slice(5))?.chatId;
  return agent.dmChatId; // dm:<owner>
}

async function unlockOwner() {
  const owner = people.get(script.people[0].key);
  const st = await owner.http('/admin/2fa/status');
  if (st.data?.unlocked) return owner;
  // A code's time step can be used only once: wait for a fresh step if needed.
  for (let i = 0; i < 3; i++) {
    const r = await owner.http('/admin/2fa/unlock', { method: 'POST', body: { code: totp(owner.totpSecret) } });
    if (r.status === 200) return owner;
    await sleep(31000 - (Date.now() % 30000));
  }
  problem('owner unlock', 'could not unlock the admin panel');
  return owner;
}

async function handle(e) {
  const p = e.from ? people.get(e.from) : null;
  if (p && (p.blocked || p.deleted) && !['owner_action'].includes(e.type)) { report.notes.push(`${e.id}: skipped, ${e.from} is ${p.deleted ? 'deleted' : 'blocked'}`); return; }
  switch (e.type) {
    case 'message':
    case 'file': {
      if (e.to.startsWith('dm:')) await ensureDm(e.from, e.to.slice(3));
      const chatId = chatOf(e.from, e.to);
      if (!chatId) return problem(e.id, `no chat for ${e.to}`);
      const payload = { text: e.text ?? '' };
      if (e.replyTo && msgIds.get(e.replyTo)?.chatId === chatId) payload.replyToId = msgIds.get(e.replyTo).messageId;
      if (e.type === 'file') {
        const ext = e.fileName.split('.').pop();
        const content = ext === 'csv' ? 'date,meetings\n2026-10-20,42\n' : `${e.fileName}\nNorthwind Labs internal document (simulation).\n`;
        const form = new FormData();
        form.append('file', new Blob([content], { type: 'application/octet-stream' }), e.fileName);
        const up = await p.http('/upload/file', { method: 'POST', form });
        if (!ok(up, `${e.id} upload ${e.fileName}`)) return;
        payload.file = up.data;
        if (!payload.text) payload.text = '';
      }
      const expected = membersOf(e.from, e.to).filter((k) => k !== e.from && !people.get(k)?.blocked && !people.get(k)?.deleted);
      const res = await sendMessage(p, chatId, payload);
      if (res.error) return problem(e.id, `send failed: ${res.error}`, { to: e.to });
      msgIds.set(e.id, { messageId: res.message.id, chatId, from: e.from });
      sent.push({ messageId: res.message.id, chatId, expected, at: Date.now(), event: e.id });
      report.latencies.push(res.ms);
      if (e.text && res.message.text !== e.text) problem(e.id, 'stored text differs from what was sent');
      count(e.type === 'file' ? 'file sent' : 'message sent');
      // Readers open the chat now and then.
      if (Math.random() < 0.3) for (const k of expected.slice(0, 3)) people.get(k)?.socket?.emit('chat:read', { chatId });
      return;
    }
    case 'edit': {
      const ref = msgIds.get(e.of);
      if (!ref) return report.notes.push(`${e.id}: edit target ${e.of} was not sent`);
      p.socket.emit('message:edit', { messageId: ref.messageId, chatId: ref.chatId, text: e.text });
      count('edit');
      return;
    }
    case 'delete': {
      const ref = msgIds.get(e.of);
      if (!ref) return report.notes.push(`${e.id}: delete target ${e.of} was not sent`);
      p.socket.emit('message:delete', { messageId: ref.messageId, chatId: ref.chatId });
      ref.deleted = true;
      count('delete');
      return;
    }
    case 'agent_status':
    case 'agent_message':
    case 'agent_question':
    case 'agent_handoff': {
      const agent = agents.get(e.agent);
      const chatId = agentChat(agent, e.to);
      if (!chatId) return problem(e.id, `agent ${e.agent} has no chat ${e.to}`);
      const t0 = performance.now();
      let r;
      if (e.type === 'agent_status') r = await agentCall(agent, '/status', { chatId, state: e.state, text: e.text });
      else if (e.type === 'agent_message') r = await agentCall(agent, '/messages', { chatId, text: e.text });
      else if (e.type === 'agent_question') r = await agentCall(agent, '/questions', { chatId, question: e.question, options: e.options ?? [] });
      else r = await agentCall(agent, '/handoffs', { chatId, title: e.title, summary: e.summary, done: e.done, next: e.next, files: e.files });
      if (!ok(r, `${e.id} ${e.type}`)) return;
      report.latencies.push(performance.now() - t0);
      msgIds.set(e.id, { messageId: r.data.id, chatId, agent: e.agent });
      const humans = e.to.startsWith('room:') ? [...rooms.get(e.to.slice(5)).members] : [agent.owner];
      sent.push({ messageId: r.data.id, chatId, expected: humans.filter((k) => !people.get(k)?.blocked && !people.get(k)?.deleted), at: Date.now(), event: e.id });
      count(e.type);
      if (e.type === 'agent_question' && e.answer) {
        const who = people.get(e.answer.by);
        await sleep(PACE);
        const ack = await new Promise((resolve) => who.socket.emit('question:answer', { messageId: r.data.id, answer: e.answer.text }, resolve));
        if (!ack?.ok) problem(e.id, `answer by ${e.answer.by} failed: ${ack?.error}`);
        else {
          count('question answered');
          const back = await fetch(`${BASE}/api/agent/questions/${r.data.id}`, { headers: { authorization: `Bearer ${agent.token}` } }).then((x) => x.json());
          if (back.status !== 'answered' || back.answer !== e.answer.text) problem(e.id, 'agent did not get the answer back', back);
        }
      }
      if (e.type === 'agent_handoff' && e.claimedBy) {
        // A person in the chat presses "I'll take it".
        const who = people.get(e.claimedBy);
        await sleep(PACE);
        const ack = await new Promise((resolve) => who.socket.emit('handoff:claim', { messageId: r.data.id }, resolve));
        if (!ack?.ok) problem(e.id, `${e.claimedBy} could not take the handoff: ${ack?.error}`);
        else {
          count('handoff taken by a person');
          // A second taker loses.
          const late = humans.find((k) => k !== e.claimedBy && people.get(k)?.socket?.connected);
          if (late) {
            const second = await new Promise((resolve) => people.get(late).socket.emit('handoff:claim', { messageId: r.data.id }, resolve));
            if (second?.ok) problem(e.id, `handoff taken twice (${late} after ${e.claimedBy})`);
          }
        }
      }
      return;
    }
    case 'rename': {
      const room = rooms.get(e.room);
      const r = await p.http(`/chats/${room.chatId}`, { method: 'PATCH', body: { name: e.name } });
      if (ok(r, `${e.id} rename`)) count('rename');
      return;
    }
    case 'add_member': {
      const room = rooms.get(e.room);
      const r = await p.http(`/chats/${room.chatId}/members`, { method: 'POST', body: { userId: people.get(e.person).id } });
      if (ok(r, `${e.id} add member`)) { room.members.add(e.person); count('member added'); }
      return;
    }
    case 'remove_member':
    case 'leave': {
      const room = rooms.get(e.room);
      const target = e.type === 'leave' ? e.from : e.person;
      const r = await p.http(`/chats/${room.chatId}/members/${people.get(target).id}`, { method: 'DELETE' });
      if (ok(r, `${e.id} ${e.type}`)) { room.members.delete(target); count(e.type === 'leave' ? 'left room' : 'member removed'); }
      // After leaving, the room must be closed to them.
      const peek = await people.get(target).http(`/chats/${room.chatId}/messages`);
      if (peek.status === 200) problem(e.id, `${target} can still read ${e.room} after ${e.type}`);
      return;
    }
    case 'mute': {
      const chatId = chatOf(e.from, e.to);
      const r = await p.http(`/chats/${chatId}/mute`, { method: 'PATCH', body: { muted: true } });
      if (ok(r, `${e.id} mute`)) count('mute');
      return;
    }
    case 'owner_action': {
      const owner = await unlockOwner();
      const target = people.get(e.person);
      if (e.action === 'block' || e.action === 'unblock') {
        const r = await owner.http(`/admin/users/${target.id}/block`, { method: 'POST', body: { blocked: e.action === 'block' } });
        if (!ok(r, `${e.id} ${e.action}`)) return;
        count(e.action);
        if (e.action === 'block') {
          target.blocked = true;
          await sleep(300);
          if (target.socket.connected) problem(e.id, 'blocked person still connected after block');
          const me = await target.http('/auth/me');
          if (me.status !== 401) problem(e.id, `blocked person's session still works (${me.status})`);
          const login = await session()('/auth/login', { method: 'POST', body: { email: target.email, password: target.password } });
          if (login.status !== 403) problem(e.id, `blocked person could sign in (${login.status})`);
        } else {
          target.blocked = false;
          target.http = session();
          await target.http('/auth/login', { method: 'POST', body: { email: target.email, password: target.password } });
          await connect(target);
        }
      } else if (e.action === 'reset_link') {
        const r = await owner.http(`/admin/users/${target.id}/reset-link`, { method: 'POST' });
        if (!ok(r, `${e.id} reset link`)) return;
        const newPassword = password();
        const use = await session()('/auth/reset', { method: 'POST', body: { token: r.data.token, password: newPassword } });
        if (!ok(use, `${e.id} use reset link`)) return;
        target.password = newPassword;
        await sleep(300);
        target.http = session();
        const login = await target.http('/auth/login', { method: 'POST', body: { email: target.email, password: newPassword } });
        if (ok(login, `${e.id} sign in with new password`)) { await connect(target); count('password reset'); }
      }
      return;
    }
    case 'delete_account': {
      const r = await p.http('/auth/delete-account', { method: 'POST', body: { password: p.password } });
      if (!ok(r, `${e.id} delete account`)) return;
      p.deleted = true;
      for (const a of agents.values()) if (a.owner === p.key) a.deleted = true;
      count('account deleted');
      return;
    }
    default:
      report.notes.push(`${e.id}: unknown event type ${e.type}`);
  }
}

// ---------- adversarial checks (after the week) ----------
async function attacks() {
  console.log('Adversarial checks…');
  // Everyone below is a regular person: the owner is checked separately.
  const ownerKey = script.people[0].key;
  const list = [...people.values()].filter((p) => !p.blocked && !p.deleted && p.key !== ownerKey);
  const outsiderRoom = [...rooms.values()].find((r) => list.some((p) => !r.members.has(p.key)));
  const outsider = list.find((p) => !outsiderRoom.members.has(p.key));
  const check = (name, pass, extra) => { count(pass ? 'attack blocked' : 'attack succeeded'); report.attacks.push({ name, blocked: !!pass }); if (!pass) problem(`attack: ${name}`, 'NOT blocked', extra); else console.log(`  ✓ ${name}`); };

  const err = await emitAndWaitError(outsider, 'message:send', { chatId: outsiderRoom.chatId, text: 'sneaking in' });
  check('outsider posts into a room', err === 'Forbidden', err);
  let r = await outsider.http(`/chats/${outsiderRoom.chatId}/messages`);
  check('outsider reads a room', r.status === 403 || r.status === 404, r.status);
  r = await outsider.http(`/chats/${outsiderRoom.chatId}/messages/search?q=release`);
  check('outsider searches a room', r.status === 403 || r.status === 404, r.status);
  const fileMsg = [...msgIds.entries()].find(([, v]) => v.chatId === outsiderRoom.chatId && !v.deleted);
  const roomMsgs = await people.get(outsiderRoom.creator).http(`/chats/${outsiderRoom.chatId}/messages?limit=100`);
  const withFile = (roomMsgs.data?.messages ?? roomMsgs.data ?? []).find((m) => m.file?.url);
  if (withFile) {
    const f = await fetch(BASE + withFile.file.url, { headers: { cookie: `token=${outsider.http.cookies.token}` } });
    check("outsider downloads a room's file", f.status === 403 || f.status === 404, f.status);
  } else report.notes.push(`no file in room ${outsiderRoom.key} to test file access${fileMsg ? '' : ''}`);
  r = await outsider.http('/admin/overview');
  check('regular person opens the admin panel', r.status === 404, r.status);
  r = await outsider.http('/admin/2fa/setup', { method: 'POST' });
  check('regular person starts admin 2FA setup', r.status === 404, r.status);
  r = await session()('/auth/register', { method: 'POST', body: { email: 'reuse@northwind.test', password: 'long-enough-pass', name: 'Reuse', inviteCode: list[1].inviteCode } });
  check('used invite reused', r.status === 400, r.status);
  r = await session()('/auth/register', { method: 'POST', body: { email: 'noinvite@northwind.test', password: 'long-enough-pass', name: 'No invite' } });
  check('register without invite', r.status === 400, r.status);
  // Someone else's message: edit and delete.
  const foreign = [...msgIds.entries()].find(([, v]) => v.from && v.from !== list[0].key && !v.deleted && rooms.get('general')?.chatId === v.chatId);
  if (foreign) {
    const before = (await list[0].http(`/chats/${foreign[1].chatId}/messages?limit=100`)).data;
    const e1 = await emitAndWaitError(list[0], 'message:edit', { messageId: foreign[1].messageId, chatId: foreign[1].chatId, text: 'hijacked' });
    const e2 = await emitAndWaitError(list[0], 'message:delete', { messageId: foreign[1].messageId, chatId: foreign[1].chatId });
    const after = (await list[0].http(`/chats/${foreign[1].chatId}/messages?limit=100`)).data;
    const find = (d) => (d?.messages ?? d ?? []).find((m) => m.id === foreign[1].messageId);
    check("edit someone else's message", find(after)?.text !== 'hijacked', e1);
    check("delete someone else's message", !!find(after) || !find(before), e2);
  }
  // Group powers belong to the creator.
  const notCreatorRoom = [...rooms.values()].find((x) => [...x.members].some((k) => k !== x.creator && list.some((p) => p.key === k)));
  const member = list.find((p) => notCreatorRoom.members.has(p.key) && p.key !== notCreatorRoom.creator);
  const victim = [...notCreatorRoom.members].find((k) => k !== member.key && k !== notCreatorRoom.creator);
  r = await member.http(`/chats/${notCreatorRoom.chatId}/members/${people.get(victim).id}`, { method: 'DELETE' });
  check('non-creator removes a member', r.status === 403, r.status);
  r = await member.http(`/chats/${notCreatorRoom.chatId}`, { method: 'PATCH', body: { name: 'pwned' } });
  check('non-creator renames a room', r.status === 403, r.status);
  // Noisy checks run in a throwaway room so the demo chats stay clean.
  const spammer = list[list.length - 1];
  const drill = await spammer.http('/chats/group', { method: 'POST', body: { name: 'Security drill', participantIds: [list[0].id] } });
  const spamChat = drill.data.id;
  let limited = false;
  spammer.onError = (e) => { if (e === 'Too many messages') limited = true; };
  for (let i = 0; i < 15; i++) spammer.socket.emit('message:send', { chatId: spamChat, text: `spam ${i}` });
  await sleep(1500);
  spammer.onError = null;
  check('message flood is rate-limited', limited);
  // Uploads: dangerous types.
  const form = new FormData();
  form.append('file', new Blob(['<script>alert(1)</script>'], { type: 'text/html' }), 'evil.html');
  r = await spammer.http('/upload/file', { method: 'POST', form });
  check('upload an .html file', r.status === 400, r.status);
  // Fake file reference pointing outside uploads.
  const e3 = await emitAndWaitError(spammer, 'message:send', { chatId: spamChat, text: 'look', file: { url: '/etc/passwd', name: 'x.txt', size: 1 } });
  check('message with a forged file path', e3 === 'Invalid file', e3);
  r = await spammer.http(`/chats/${spamChat}`, { method: 'DELETE' });
  if (![200, 204].includes(r.status)) report.notes.push(`could not delete the drill room (${r.status})`);
  // Handoffs: an outsider cannot take one.
  const handoff = [...msgIds.entries()].find(([k]) => script.days.flatMap((d) => d.events).find((x) => x.id === k)?.type === 'agent_handoff');
  if (handoff) {
    const stranger = list.find((p) => !(rooms.get([...rooms.values()].find((x) => x.chatId === handoff[1].chatId)?.key)?.members.has(p.key)));
    if (stranger) {
      const ack = await new Promise((resolve) => stranger.socket.emit('handoff:claim', { messageId: handoff[1].messageId }, resolve));
      check('outsider takes a handoff', !ack?.ok, ack);
    }
  }
  // Agents: only their own chats; dead keys after account deletion.
  const agent = [...agents.values()].find((a) => !a.deleted);
  const foreignChat = [...rooms.values()].find((x) => !x.agents.has(agent.key))?.chatId ?? [...dms.values()][0];
  r = await agentCall(agent, '/messages', { chatId: foreignChat, text: 'agent sneaking in' });
  check('agent posts into a room it is not in', r.status >= 400, r.status);
  r = await agentCall({ token: 'zk_' + 'x'.repeat(40) }, '/messages', { text: 'forged key' });
  check('agent with a forged key', r.status === 401, r.status);
  for (const a of agents.values()) if (a.deleted) {
    r = await agentCall(a, '/status', { state: 'info', text: 'still alive?' });
    check(`deleted owner's agent (${a.key}) still works`, r.status === 401, r.status);
  }
  // Owner panel: wrong 2FA codes hit the limit; the owner's session stays fine.
  const thief = session();
  const owner = people.get(script.people[0].key);
  await thief('/auth/login', { method: 'POST', body: { email: owner.email, password: owner.password } });
  r = await thief('/admin/overview');
  check('owner password without the phone', r.status === 401, r.status);
  // Search must not leak blocked or deleted people.
  for (const p of people.values()) if (p.deleted || p.blocked) {
    r = await list[0].http(`/users/search?q=${encodeURIComponent(p.name.split(' ')[0])}`);
    check(`search hides ${p.deleted ? 'deleted' : 'blocked'} ${p.key}`, !(r.data ?? []).some((u) => u.id === p.id));
  }
}

// ---------- delivery + consistency ----------
async function verify() {
  await sleep(1500);
  let missing = 0, checked = 0;
  for (const s of sent) {
    for (const k of s.expected) {
      const p = people.get(k);
      if (!p || p.deleted || p.blocked || !p.socket?.connected) continue;
      checked++;
      if (!p.received.has(s.messageId)) { missing++; if (missing <= 15) problem('delivery', `${k} did not receive ${s.event}`); }
    }
  }
  report.delivery = { checked, missing };
  // Server history matches what was sent (sample of rooms).
  for (const room of rooms.values()) {
    const reader = people.get([...room.members].find((k) => !people.get(k)?.deleted && !people.get(k)?.blocked));
    if (!reader) continue;
    let all = [];
    for (let offset = 0; offset < 2000; offset += 100) {
      const r = await reader.http(`/chats/${room.chatId}/messages?limit=100&offset=${offset}`);
      const page = r.data?.messages ?? r.data ?? [];
      all = all.concat(page);
      if (page.length < 100) break;
    }
    const ids = new Set(all.map((m) => m.id));
    const expected = [...msgIds.values()].filter((v) => v.chatId === room.chatId && !v.deleted);
    const lost = expected.filter((v) => !ids.has(v.messageId));
    const ghosts = [...msgIds.values()].filter((v) => v.chatId === room.chatId && v.deleted && ids.has(v.messageId));
    if (lost.length) problem(`history ${room.key}`, `${lost.length} sent messages missing`);
    if (ghosts.length) problem(`history ${room.key}`, `${ghosts.length} deleted messages still listed`);
    count('room history checked');
  }
}

// ---------- main ----------
const t0 = Date.now();
await setup();
let n = 0;
for (const day of script.days) {
  console.log(`${day.day}: ${day.events.length} events`);
  const byType = {};
  for (const e of day.events) byType[e.type] = (byType[e.type] ?? 0) + 1;
  report.perDay.push({ day: day.day, events: day.events.length, byType });
  for (const e of day.events) {
    try { await handle(e); } catch (err) { problem(e.id, `crashed: ${err.message}`); }
    n++;
    await sleep(PACE);
  }
}
await verify();
await attacks();

const lat = report.latencies.sort((a, b) => a - b);
const pct = (q) => Math.round(lat[Math.min(lat.length - 1, Math.floor(q * lat.length))] ?? 0);
report.latency = { count: lat.length, p50: pct(0.5), p95: pct(0.95), max: Math.round(lat[lat.length - 1] ?? 0) };
const edges = [5, 10, 15, 20, 30, 50, 100, Infinity];
report.latencyHistogram = edges.map((hi, i) => ({ from: i ? edges[i - 1] : 0, to: hi === Infinity ? null : hi, count: lat.filter((v) => v >= (i ? edges[i - 1] : 0) && v < hi).length }));
delete report.latencies;
report.events = n;
report.durationSec = Math.round((Date.now() - t0) / 1000);
report.socketErrors = Object.fromEntries([...people.values()].filter((p) => p.errors?.length).map((p) => [p.key, p.errors.slice(0, 5)]));

const owner = people.get(script.people[0].key);
writeFileSync(join(OUT, 'credentials.json'), JSON.stringify({
  base: BASE,
  note: 'Simulation accounts on the separate demo copy (docker-compose.sim.yml). Not real people. Keep out of git.',
  owner: { email: owner.email, password: owner.password, totpSecret: owner.totpSecret, recoveryCodes: owner.recoveryCodes },
  people: [...people.values()].map((p) => ({ key: p.key, name: p.name, email: p.email, password: p.password, state: p.deleted ? 'deleted' : p.blocked ? 'blocked' : 'active' })),
}, null, 2));
writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
const md = [
  `# Simulation report (${report.startedAt})`,
  '', `Events: ${n} in ${report.durationSec}s · problems: ${report.problems.length}`,
  `Latency (send → server echo / agent API): p50 ${report.latency.p50} ms, p95 ${report.latency.p95} ms, max ${report.latency.max} ms`,
  `Delivery: ${report.delivery.checked - report.delivery.missing}/${report.delivery.checked} live deliveries arrived`,
  '', '## Counts', ...Object.entries(report.counts).map(([k, v]) => `- ${k}: ${v}`),
  '', '## Problems', ...(report.problems.length ? report.problems.map((p) => `- **${p.where}**: ${p.what}${p.extra ? ' `' + JSON.stringify(p.extra).slice(0, 160) + '`' : ''}`) : ['- none']),
  '', '## Notes', ...(report.notes.length ? report.notes.map((x) => `- ${x}`) : ['- none']),
].join('\n');
writeFileSync(join(OUT, 'report.md'), md + '\n');
console.log('\n' + md.split('\n').slice(0, 6).join('\n'));
for (const p of people.values()) p.socket?.close();
process.exit(0);
