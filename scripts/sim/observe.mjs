// Real-browser observers for the simulation: signs in as a few people in
// headless Edge/Chrome (CDP), opens their chats, takes screenshots, runs axe,
// and records console errors and any script that managed to run from message
// content (window.alert is trapped before the app loads).
//
//   msedge --headless=new --remote-debugging-port=9340 --user-data-dir=<tmp> about:blank
//   node scripts/sim/observe.mjs [port] [--axe <path to axe.min.js>]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const port = args.find((a) => /^\d+$/.test(a)) ?? '9340';
const axePath = args.includes('--axe') ? args[args.indexOf('--axe') + 1] : null;
const creds = JSON.parse(readFileSync(join(here, 'out/credentials.json'), 'utf8'));
const BASE = creds.base;
const shots = join(here, 'out/shots');
mkdirSync(shots, { recursive: true });
const AXE = axePath ? readFileSync(axePath, 'utf8') : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
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
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;

await send('Page.enable'); await send('Runtime.enable');
await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__ran = []; window.alert = (x) => window.__ran.push(String(x)); window.confirm = () => true;` });
const SIZES = { desktop: { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, mobile: { width: 390, height: 844, deviceScaleFactor: 2, mobile: true } };
const result = { observers: [], scriptsRan: [], consoleErrors, axe: {} };
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 74 });
  writeFileSync(join(shots, `${name}.jpg`), Buffer.from(r.result.data, 'base64'));
};

const active = creds.people.filter((p) => p.state === 'active');
const observers = [active[0], active.find((p) => /[а-яё]/i.test(p.name)) ?? active[5], active[Math.floor(active.length / 2)]].filter(Boolean);
for (const [i, person] of observers.entries()) {
  const size = i === 2 ? 'mobile' : 'desktop';
  await send('Emulation.setDeviceMetricsOverride', SIZES[size]);
  await send('Page.navigate', { url: `${BASE}/login` }); await sleep(1500);
  await evaluate(`localStorage.setItem('zokul-lang', '${/[а-яё]/i.test(person.name) ? 'ru' : 'en'}'); localStorage.setItem('zokul-push-hint', 'dismissed')`);
  const status = await evaluate(`fetch('/api/auth/logout', { method: 'POST' }).catch(() => 0).then(() => fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: ${JSON.stringify(person.email)}, password: ${JSON.stringify(person.password)} }) })).then((r) => r.status)`);
  if (status !== 200) { result.observers.push({ who: person.key, error: `login ${status}` }); continue; }
  await send('Page.navigate', { url: BASE + '/' }); await sleep(2500);
  const tag = `${i + 1}-${person.key}-${size}`;
  await shot(`${tag}-list`);
  // Open each chat in the list (up to 6) and look at it.
  const names = await evaluate(`[...document.querySelectorAll('aside li button, aside [role=listitem] button, aside button')].map((b) => b.innerText.split('\\n')[0]).filter((t) => t && t.length < 60).slice(1, 9)`);
  let opened = 0;
  for (const name of names ?? []) {
    const clicked = await evaluate(`(() => { const b = [...document.querySelectorAll('aside button')].find((x) => x.innerText.split('\\n')[0] === ${JSON.stringify(name)}); if (b) b.click(); return !!b; })()`);
    if (!clicked) continue;
    await sleep(1300);
    opened++;
    await shot(`${tag}-chat-${opened}`);
    if (AXE && opened <= 2) {
      await evaluate(AXE);
      result.axe[`${tag}-chat-${opened}`] = await evaluate(`axe.run(document, { resultTypes: ['violations'] }).then((r) => r.violations.map((v) => v.id + ' (' + v.nodes.length + ')'))`);
    }
    if (size === 'mobile') { await evaluate(`history.back()`); await sleep(900); }
    if (opened >= 6) break;
  }
  const ran = await evaluate('window.__ran');
  if (ran?.length) result.scriptsRan.push({ who: person.key, ran });
  result.observers.push({ who: person.key, size, chatsOpened: opened });
}
writeFileSync(join(here, 'out/observe.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ observers: result.observers, scriptsRan: result.scriptsRan, consoleErrors: consoleErrors.slice(0, 10), axe: result.axe }, null, 1));
ws.close();
