// Visual QA in one command: opens every main screen of Zokul in a real headless
// browser (Edge or Chrome), in light and dark, on a phone and a desktop, takes
// screenshots, runs axe accessibility checks, finds sideways scrolling on the phone,
// traps any script that runs from
// message content, collects console errors, and builds one contact sheet per screen.
//
//   cd scripts/qa && npm install            # once: axe-core + sharp
//   npm run visual                          # against the demo copy (:8080, after scripts/sim)
//   npm run visual -- --lang ru             # Russian interface
//
// Output (git-ignored): scripts/qa/out/visual/<screen>__<size>-<theme>.jpg, sheets/, report.json
// Exit code 1 when axe finds violations, a script ran, or the console logged errors.
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import crypto from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const lang = arg('lang', 'en');
const credsFile = arg('creds', join(here, '../sim/out/credentials.json'));
if (!existsSync(credsFile)) {
  console.error(`No demo accounts found at ${credsFile}.\nRun the company simulation first (scripts/sim/README.md).`);
  process.exit(2);
}
const creds = JSON.parse(readFileSync(credsFile, 'utf8'));
const BASE = arg('base', creds.base);
const OUT = join(here, 'out/visual');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'sheets'), { recursive: true });
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- browser ----------
const candidates = [
  process.env.BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/microsoft-edge',
].filter(Boolean);
const exe = candidates.find((p) => existsSync(p));
if (!exe) { console.error('No Edge or Chrome found. Set BROWSER=<path to the browser>.'); process.exit(2); }
const port = 9400 + Math.floor(Math.random() * 400);
const profile = join(tmpdir(), `zokul-visual-${process.pid}`); // fresh profile: no stale service worker
const browser = spawn(exe, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
let targets;
for (let i = 0; i < 40 && !targets; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { await sleep(300); } }
if (!targets) { console.error('The browser did not start.'); browser.kill(); process.exit(2); }

const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map();
const consoleErrors = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') consoleErrors.push(m.params.exceptionDetails.exception?.description?.split('\n')[0] ?? m.params.exceptionDetails.text);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push(m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 200));
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
await send('Page.enable'); await send('Runtime.enable');
await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__ran = []; window.alert = (x) => window.__ran.push(String(x)); window.confirm = () => true;' });

// ---------- helpers ----------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function totp(secret) {
  let bits = 0, value = 0; const key = [];
  for (const ch of secret) { value = (value << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { key.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = crypto.createHmac('sha1', Buffer.from(key)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0');
}
const SIZES = {
  phone: { width: 390, height: 844, deviceScaleFactor: 2, mobile: true },
  desktop: { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false },
};
const T = lang === 'ru'
  ? { search: 'Поиск по чату', searchInput: 'Поиск по этому чату', group: 'О группе', profile: 'Профиль', agents: 'ИИ-агенты', newChat: 'Новый чат', admin: ['Обзор', 'Приглашения', 'Люди', 'Агенты', 'Журнал действий'] }
  : { search: 'Search in chat', searchInput: 'Search in this chat', group: 'Group info', profile: 'Profile', agents: 'AI agents', newChat: 'New chat', admin: ['Overview', 'Invites', 'People', 'Agents', 'Activity log'] };
const HELPERS = `
window.__click = async (text, sel = 'button, a, summary') => { const el = [...document.querySelectorAll(sel)].find((x) => (x.innerText || '').trim().split('\\n').includes(text) || (x.innerText || '').trim() === text || x.getAttribute('aria-label') === text || x.getAttribute('title') === text); if (el) el.click(); await new Promise((r) => setTimeout(r, 800)); return !!el; };
window.__type = async (selector, value) => { const el = document.querySelector(selector); if (!el) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); await new Promise((r) => setTimeout(r, 900)); return true; };`;
async function go(path) { await send('Page.navigate', { url: BASE + path }); await sleep(1700); await ev(HELPERS); }
const report = { base: BASE, lang, axe: {}, overflow: {}, missing: [], scriptsRan: [], consoleErrors };
const shots = new Set();
async function shot(name, tag) {
  const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 72 });
  writeFileSync(join(OUT, `${name}__${tag}.jpg`), Buffer.from(r.result.data, 'base64'));
  shots.add(name);
}
async function axe(name) {
  await ev(AXE);
  const v = await ev(`axe.run(document, { resultTypes: ['violations'] }).then((r) => r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) })))`);
  if (v?.length) report.axe[name] = v;
}
// Anything that scrolls sideways on a phone (code blocks may; the page and chat panes may not).
async function overflow(name) {
  const found = await ev(`(() => {
    const out = [];
    if (document.documentElement.scrollWidth > innerWidth + 1) out.push('page ' + document.documentElement.scrollWidth + 'px wide');
    for (const el of document.querySelectorAll('*')) {
      const st = getComputedStyle(el);
      if (!['auto', 'scroll'].includes(st.overflowX) || el.closest('pre, code')) continue;
      if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 2) out.push(el.tagName.toLowerCase() + '.' + String(el.className).split(' ').slice(0, 3).join('.') + ' ' + el.scrollWidth + '/' + el.clientWidth);
    }
    return out.slice(0, 5);
  })()`);
  if (found?.length) report.overflow[name] = found;
}
async function signIn(email, password) {
  await go('/login');
  return ev(`fetch('/api/auth/logout', { method: 'POST' }).catch(() => 0).then(() => fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: ${JSON.stringify(email)}, password: ${JSON.stringify(password)} }) })).then((r) => r.status)`);
}

// Pick a person who has a room, a direct chat with a person and an agent chat.
const active = creds.people.filter((p) => p.state === 'active' && p.email !== creds.owner.email);
let viewer = null, names = null;
for (const p of active) {
  const login = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: p.email, password: p.password }) });
  if (login.status !== 200) continue;
  const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const me = (await (await fetch(BASE + '/api/auth/me', { headers: { cookie } })).json()).user;
  const chats = await (await fetch(BASE + '/api/chats', { headers: { cookie } })).json();
  const other = (c) => c.participants.find((u) => u.id !== me.id);
  const room = chats.find((c) => c.isGroup);
  const dm = chats.find((c) => !c.isGroup && !other(c)?.isAgent);
  const agent = chats.find((c) => !c.isGroup && other(c)?.isAgent);
  if (room && dm && agent) { viewer = p; names = { room: room.name, dm: other(dm).name, agent: other(agent).name }; break; }
}
if (!viewer) { console.error('No demo person with a room, a direct chat and an agent chat.'); browser.kill(); process.exit(2); }
console.log(`Viewer: ${viewer.name} · room "${names.room}", direct chat "${names.dm}", agent "${names.agent}"`);

const SCREENS = [
  ['list', async () => {}],
  ['room', async () => { await ev(`__click(${JSON.stringify(names.room)}, 'aside button')`); }],
  ['direct', async () => { await ev(`__click(${JSON.stringify(names.dm)}, 'aside button')`); }],
  ['agent-chat', async () => { await ev(`__click(${JSON.stringify(names.agent)}, 'aside button')`); }],
  ['search', async () => { await ev(`__click(${JSON.stringify(names.room)}, 'aside button')`); await ev(`__click('${T.search}')`); await ev(`__type('input[placeholder^="${T.searchInput}"]', 'release')`); }],
  ['room-info', async () => { await ev(`__click(${JSON.stringify(names.room)}, 'aside button')`); await ev(`__click('${T.group}')`); }],
  ['profile', async () => { await ev(`document.querySelector('aside button')?.click()`); await sleep(700); }],
  ['agents', async () => { await ev(`__click('${T.agents}')`); }],
  ['new-chat', async () => { await ev(`__click('${T.newChat}')`); }],
];

for (const theme of ['light', 'dark']) {
  for (const [size, metrics] of Object.entries(SIZES)) {
    await send('Emulation.setDeviceMetricsOverride', metrics);
    const tag = `${size}-${theme}`;
    await go('/login');
    await ev(`fetch('/api/auth/logout', { method: 'POST' }).catch(() => 0); localStorage.setItem('zokul-theme', '${theme}'); localStorage.setItem('zokul-lang', '${lang}'); localStorage.setItem('zokul-push-hint', 'hidden')`);
    await go('/login'); await shot('login', tag); if (size === 'desktop') await axe(`login-${theme}`);
    await go('/register?invite=inv_example'); await shot('register', tag);
    await signIn(viewer.email, viewer.password);
    for (const [name, open] of SCREENS) {
      await go('/');
      await open();
      await sleep(700);
      await shot(name, tag);
      if (size === 'desktop') await axe(`${name}-${theme}`);
      else await overflow(`${name}-${theme}`);
    }
    const ran = await ev('window.__ran');
    if (ran?.length) report.scriptsRan.push({ tag, ran });
    // The owner's panel, unlocked with a code from the owner's authenticator.
    await signIn(creds.owner.email, creds.owner.password);
    await go('/admin');
    const locked = await ev(`!!document.querySelector('input[autocomplete=one-time-code]')`);
    if (locked) {
      await shot('admin-locked', tag);
      await ev(`(async () => { await __type('input[autocomplete=one-time-code]', '${totp(creds.owner.totpSecret)}'); document.querySelector('form button[type=submit]').click(); })()`);
      await sleep(1800);
    }
    const sections = ['overview', 'invites', 'people', 'agents', 'activity'];
    for (const [i, label] of T.admin.entries()) {
      const ok = await ev(`__click(${JSON.stringify(label)}, 'nav button')`);
      if (!ok) { report.missing.push(`admin ${label} (${tag})`); continue; }
      await sleep(600);
      await shot(`admin-${sections[i]}`, tag);
      if (size === 'desktop' && i === 0) await axe(`admin-overview-${theme}`);
    }
    // Each code works only once: wait for the next 30-second step before unlocking again.
    await sleep(31000 - (Date.now() % 30000));
  }
}

// ---------- contact sheets ----------
const sharp = require('sharp');
for (const name of shots) {
  const tile = async (tag, w, h) => {
    const f = join(OUT, `${name}__${tag}.jpg`);
    return existsSync(f) ? sharp(f).resize(w, h, { fit: 'contain', background: '#888' }).toBuffer() : null;
  };
  const layout = [['desktop-light', 800, 500, 0, 0], ['desktop-dark', 800, 500, 810, 0], ['phone-light', 300, 650, 0, 510], ['phone-dark', 300, 650, 310, 510]];
  const parts = [];
  for (const [tag, w, h, left, top] of layout) { const input = await tile(tag, w, h); if (input) parts.push({ input, left, top }); }
  await sharp({ create: { width: 1610, height: 1160, channels: 3, background: '#777' } }).composite(parts).jpeg({ quality: 70 }).toFile(join(OUT, 'sheets', `${name}.jpg`));
}

writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
ws.close();
browser.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch { /* the browser may still hold it */ }

const axeCount = Object.values(report.axe).reduce((n, v) => n + v.length, 0);
console.log(`\n${shots.size} screens × 4 (light/dark × phone/desktop) → ${OUT}`);
console.log(`axe violations: ${axeCount}${axeCount ? ' → ' + Object.keys(report.axe).join(', ') : ''}`);
const overflowCount = Object.keys(report.overflow).length;
console.log(`sideways scrolling on the phone: ${overflowCount}${overflowCount ? ' → ' + Object.keys(report.overflow).join(', ') : ''}`);
console.log(`scripts ran from content: ${report.scriptsRan.length} · console errors: ${consoleErrors.length} · missing: ${report.missing.length}`);
process.exitCode = axeCount || overflowCount || report.scriptsRan.length || consoleErrors.length ? 1 : 0;
