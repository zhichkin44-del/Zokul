// Live check of password reset links and account deletion against http://localhost.
// Usage (local stack only; Alice must be the owner with 2FA reset: `owner.js transfer alice@zokul.test`):
//   node scripts/qa/account-live.mjs <alicePwFile>
// Creates a throwaway person "Eve <eve-<time>@zokul.test>" through a real invite and deletes her at the end.
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';

const [pwFile] = process.argv.slice(2);
const BASE = 'http://localhost/api';
let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!ok) fails++; };

function jar(bearer) {
  const cookies = {};
  return async (path, opts = {}) => {
    const headers = { 'content-type': 'application/json', cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ') };
    if (bearer) headers.authorization = `Bearer ${bearer}`;
    const res = await fetch(BASE + path, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const i = kv.indexOf('=');
      if (kv.slice(i + 1) === '') delete cookies[kv.slice(0, i)];
      else cookies[kv.slice(0, i)] = kv.slice(i + 1);
    }
    let data = null;
    try { data = await res.json(); } catch { /* empty */ }
    return { status: res.status, data };
  };
}

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function totp(secret) {
  let bits = 0, value = 0; const key = [];
  for (const ch of secret) { value = (value << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { key.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = crypto.createHmac('sha1', Buffer.from(key)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0');
}

// Owner: sign in, set up 2FA, unlock.
const admin = jar();
await admin('/auth/login', { method: 'POST', body: { email: 'alice@zokul.test', password: readFileSync(pwFile, 'utf8').trim() } });
const setup = await admin('/admin/2fa/setup', { method: 'POST' });
const enabled = await admin('/admin/2fa/enable', { method: 'POST', body: { code: totp(setup.data.secret) } });
check('owner unlocks the panel', enabled.status === 200, String(enabled.status));
const me = (await admin('/auth/me')).data.user;

// A throwaway person joins through an invite.
const invite = await admin('/admin/invites', { method: 'POST', body: { label: 'QA Eve', maxUses: 1, expiresInDays: 1 } });
const email = `eve-${Date.now()}@zokul.test`;
const eve = jar();
let r = await eve('/auth/register', { method: 'POST', body: { email, password: 'eve-old-password', name: 'Eve QA', inviteCode: invite.data.code } });
check('Eve joins with an invite', r.status === 201, String(r.status));
const eveId = r.data?.user?.id;
const agent = await eve('/agents', { method: 'POST', body: { name: 'Eve bot' } });
const agentToken = agent.data?.token;
check('Eve has an agent with a working key', (await jar(agentToken)('/agent/me')).status === 200);

// Reset links.
r = await admin(`/admin/users/${me.id}/reset-link`, { method: 'POST' });
check('no reset link for the owner', r.status === 404, String(r.status));
r = await admin(`/admin/users/${agent.data?.agent?.id ?? agent.data?.id}/reset-link`, { method: 'POST' });
check('no reset link for an agent', r.status === 404, String(r.status));
r = await admin(`/admin/users/${eveId}/reset-link`, { method: 'POST' });
const first = r.data?.token;
check('owner makes a reset link for Eve', r.status === 201 && /^rst_/.test(first), String(r.status));
r = await admin(`/admin/users/${eveId}/reset-link`, { method: 'POST' });
const token = r.data?.token;
r = await jar()('/auth/reset/check', { method: 'POST', body: { token: first } });
check('a new link replaces the old one', r.status === 400, String(r.status));
r = await jar()('/auth/reset/check', { method: 'POST', body: { token } });
check('link check shows whose it is', r.status === 200 && r.data.name === 'Eve QA', JSON.stringify(r.data));
r = await jar()('/auth/reset', { method: 'POST', body: { token, password: 'short' } });
check('weak password refused, link not used up', r.status === 400 && (await jar()('/auth/reset/check', { method: 'POST', body: { token } })).status === 200);
r = await jar()('/auth/reset', { method: 'POST', body: { token, password: 'eve-new-password' } });
check('Eve sets a new password', r.status === 200, String(r.status));
r = await jar()('/auth/reset', { method: 'POST', body: { token, password: 'attacker-password' } });
check('the link works only once', r.status === 400, String(r.status));
r = await eve('/auth/me');
check("Eve's old session ended", r.status === 401, String(r.status));
r = await jar()('/auth/login', { method: 'POST', body: { email, password: 'eve-old-password' } });
check('old password no longer works', r.status === 401, String(r.status));
const eve2 = jar();
r = await eve2('/auth/login', { method: 'POST', body: { email, password: 'eve-new-password' } });
check('new password works', r.status === 200, String(r.status));
const audit = (await admin('/admin/audit?limit=20')).data.map((e) => e.action);
check('both reset events are in the log', audit.includes('password_reset_issued') && audit.includes('password_reset_used'));

// Account deletion.
r = await eve2('/auth/delete-account', { method: 'POST', body: { password: 'wrong-password' } });
check('deletion needs the right password', r.status === 400, String(r.status));
r = await admin('/auth/delete-account', { method: 'POST', body: { password: readFileSync(pwFile, 'utf8').trim() } });
check('the owner cannot delete the account', r.status === 403, String(r.status));
r = await eve2('/auth/delete-account', { method: 'POST', body: { password: 'eve-new-password' } });
check('Eve deletes her account', r.status === 200, String(r.status));
check('her session is gone', (await eve2('/auth/me')).status === 401);
r = await jar()('/auth/login', { method: 'POST', body: { email, password: 'eve-new-password' } });
check('she cannot sign in any more', r.status === 401, String(r.status));
check("her agent's key is dead", (await jar(agentToken)('/agent/me')).status === 401);
r = await admin('/users/search?q=Eve%20QA');
check('she is gone from search', r.status === 200 && !r.data.some((u) => u.id === eveId), JSON.stringify(r.data));
const listed = (await admin('/admin/users')).data.find((u) => u.id === eveId);
check('admin sees an anonymized "deleted" row', listed?.deleted === true && listed.name === 'Deleted account' && listed.email === '', JSON.stringify(listed));
r = await admin(`/admin/users/${eveId}/block`, { method: 'POST', body: { blocked: false } });
check('a deleted account cannot be unblocked', r.status === 404, String(r.status));
r = await admin(`/admin/users/${eveId}/reset-link`, { method: 'POST' });
check('no reset link for a deleted account', r.status === 404, String(r.status));
const agents = (await admin('/admin/agents')).data;
check('her agent is gone from the agent list', !agents.some((a) => a.name === 'Eve bot'));
// The same email can join again later with a new invite.
const invite2 = await admin('/admin/invites', { method: 'POST', body: { label: 'QA Eve again', maxUses: 1, expiresInDays: 1 } });
r = await jar()('/auth/register', { method: 'POST', body: { email, password: 'eve-third-password', name: 'Eve QA', inviteCode: invite2.data.code } });
check('the email is free to join again', r.status === 201, String(r.status));

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exitCode = fails ? 1 : 0;
