// Live check of owner-only admin + 2FA against http://localhost.
// Usage (local stack only, after `owner.js reset-2fa`; restart the server afterwards to clear the code limiter):
//   node scripts/qa/admin-2fa-live.mjs <adminPwFile> <otherEmail> <otherPwFile> <outRecoveryFile>
// Password files and the output file belong outside the repo.
import { readFileSync, writeFileSync } from 'node:fs';
import crypto from 'node:crypto';

const [adminPwFile, otherEmail, otherPwFile, outFile] = process.argv.slice(2);
const BASE = 'http://localhost/api';
let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!ok) fails++; };

function jar() {
  const cookies = {};
  return async (path, opts = {}) => {
    const res = await fetch(BASE + path, {
      method: opts.method || 'GET',
      headers: { 'content-type': 'application/json', cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ') },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const i = kv.indexOf('=');
      const v = kv.slice(i + 1);
      if (v === '' || /Expires=Thu, 01 Jan 1970/i.test(c)) delete cookies[kv.slice(0, i)];
      else cookies[kv.slice(0, i)] = v;
    }
    let data = null;
    try { data = await res.json(); } catch { /* empty */ }
    return { status: res.status, data, cookies };
  };
}

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32decode(s) {
  let bits = 0, value = 0; const out = [];
  for (const ch of s.replace(/=+$/, '').toUpperCase()) {
    value = (value << 5) | B32.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
function code(secret, step) {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', b32decode(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0');
}
const step = () => Math.floor(Date.now() / 30000);

const admin = jar();
const login = await admin('/auth/login', { method: 'POST', body: { email: 'alice@zokul.test', password: readFileSync(adminPwFile, 'utf8').trim() } });
check('admin signs in with password', login.status === 200, String(login.status));

let r = await admin('/admin/overview');
check('panel locked before 2FA (401 locked)', r.status === 401 && r.data?.locked === true, String(r.status));
r = await admin('/admin/2fa/status');
check('status: not enabled', r.status === 200 && r.data.enabled === false, JSON.stringify(r.data));

r = await admin('/admin/2fa/unlock', { method: 'POST', body: { code: '123456' } });
check('unlock refused before setup', r.status === 400, `${r.status} ${r.data?.error}`);

r = await admin('/admin/2fa/setup', { method: 'POST' });
const secret = r.data?.secret;
check('setup returns secret + QR', r.status === 200 && /^[A-Z2-7]{32}$/.test(secret) && r.data.qr.startsWith('data:image/png;base64,'), String(r.status));
check('otpauth url names Zokul', /^otpauth:\/\/totp\/Zokul/.test(r.data?.otpauthUrl ?? ''), r.data?.otpauthUrl?.split('?')[0]);

r = await admin('/admin/2fa/enable', { method: 'POST', body: { code: '000000' } });
check('enable rejects a wrong code', r.status === 401, String(r.status));

const s0 = step();
r = await admin('/admin/2fa/enable', { method: 'POST', body: { code: code(secret, s0) } });
const recovery = r.data?.recoveryCodes ?? [];
check('enable with the right code', r.status === 200 && recovery.length === 10, String(r.status));
writeFileSync(outFile, recovery.join('\n') + '\n# secret: ' + secret + '\n');
check('enable sets the unlock cookie', !!r.cookies.zokul_admin);

r = await admin('/admin/overview');
check('panel opens after enable', r.status === 200, String(r.status));
r = await admin('/admin/2fa/setup', { method: 'POST' });
check('setup cannot be restarted once on', r.status === 400, String(r.status));

r = await admin('/admin/lock', { method: 'POST' });
check('lock', r.status === 200 && !r.cookies.zokul_admin);
r = await admin('/admin/overview');
check('panel locked after lock', r.status === 401 && r.data?.locked, String(r.status));

r = await admin('/admin/2fa/unlock', { method: 'POST', body: { code: code(secret, s0) } });
check('replay of the setup code refused', r.status === 401, String(r.status));

// Wait for the next 30-second step so a fresh code exists.
const wait = (step() + 1) * 30000 - Date.now() + 500;
console.log(`…waiting ${Math.round(wait / 1000)}s for the next code`);
await new Promise((res) => setTimeout(res, wait));
const fresh = code(secret, step());
r = await admin('/admin/2fa/unlock', { method: 'POST', body: { code: fresh } });
check('unlock with a fresh code', r.status === 200 && !!r.cookies.zokul_admin, String(r.status));
r = await admin('/admin/users');
check('panel open after unlock', r.status === 200, String(r.status));

// Another browser with the same password but no phone: stays locked.
const thief = jar();
await thief('/auth/login', { method: 'POST', body: { email: 'alice@zokul.test', password: readFileSync(adminPwFile, 'utf8').trim() } });
r = await thief('/admin/2fa/unlock', { method: 'POST', body: { code: fresh } });
check('same code from another browser refused (replay)', r.status === 401, String(r.status));
r = await thief('/admin/overview');
check('password alone does not open the panel', r.status === 401, String(r.status));
r = await thief('/admin/2fa/setup', { method: 'POST' });
check('password alone cannot re-run setup', r.status === 400, String(r.status));

// Recovery code: works once.
r = await thief('/admin/2fa/unlock', { method: 'POST', body: { code: recovery[0].toUpperCase() } });
check('recovery code unlocks', r.status === 200, String(r.status));
const thief2 = jar();
await thief2('/auth/login', { method: 'POST', body: { email: 'alice@zokul.test', password: readFileSync(adminPwFile, 'utf8').trim() } });
r = await thief2('/admin/2fa/unlock', { method: 'POST', body: { code: recovery[0] } });
check('recovery code works only once', r.status === 401, String(r.status));

// Rate limit: 6 tries per 15 minutes on this account (some used above).
let limited = false;
for (let i = 0; i < 8; i++) {
  r = await thief2('/admin/2fa/unlock', { method: 'POST', body: { code: '999999' } });
  if (r.status === 429) { limited = true; break; }
}
check('brute force hits the limit (429)', limited, String(r.status));

// Non-admin: the panel does not exist.
const other = jar();
r = await other('/auth/login', { method: 'POST', body: { email: otherEmail, password: readFileSync(otherPwFile, 'utf8').trim() } });
check('other person signs in', r.status === 200, String(r.status));
for (const p of ['/admin/2fa/status', '/admin/overview']) {
  r = await other(p);
  check(`non-admin gets 404 on ${p}`, r.status === 404, String(r.status));
}
r = await other('/admin/2fa/setup', { method: 'POST' });
check('non-admin cannot start setup (404)', r.status === 404, String(r.status));

// The first browser was not affected by the other browsers' attempts.
r = await admin('/admin/overview');
check('first browser still unlocked', r.status === 200, String(r.status));

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exitCode = fails ? 1 : 0;
