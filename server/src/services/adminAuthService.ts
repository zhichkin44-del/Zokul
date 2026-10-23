import jwt from 'jsonwebtoken';
import QRCode from 'qrcode';
import { pool } from '../config/db';
import { config } from '../config/app';
import * as totp from './totpService';
import { logEvent } from './auditService';

// The admin panel needs a second factor on top of the normal session:
// after a TOTP code the owner gets a short "admin unlock" cookie that
// expires after 15 minutes without admin activity.

export const ADMIN_COOKIE = 'zokul_admin';
export const ADMIN_IDLE_MS = 15 * 60 * 1000;

export class AdminAuthError extends Error {
  constructor(message: string, readonly status: 400 | 401 | 403 = 400) {
    super(message);
  }
}

interface TotpRow {
  email: string;
  token_version: number;
  totp_secret: string | null;
  totp_pending: string | null;
  totp_enabled: boolean;
  totp_last_step: string | null;
  totp_recovery: string[] | null;
}

async function load(userId: string): Promise<TotpRow> {
  const r = await pool.query(
    `SELECT email, token_version, totp_secret, totp_pending, totp_enabled, totp_last_step, totp_recovery
     FROM users WHERE id = $1 AND role = 'admin' AND blocked = false`,
    [userId]
  );
  if (!r.rows[0]) throw new AdminAuthError('Not found', 403);
  return r.rows[0];
}

export function issueUnlock(userId: string, tokenVersion: number): string {
  return jwt.sign({ userId, tokenVersion, purpose: 'admin' }, config.jwtSecret, { algorithm: 'HS256', expiresIn: ADMIN_IDLE_MS / 1000 });
}

// Valid only for this user, this session generation, and the admin purpose.
export async function checkUnlock(token: string | undefined, userId: string): Promise<boolean> {
  if (!token) return false;
  try {
    const p = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] }) as { userId: string; tokenVersion: number; purpose: string };
    if (p.purpose !== 'admin' || p.userId !== userId) return false;
    const row = await load(userId);
    return row.totp_enabled && p.tokenVersion === row.token_version;
  } catch {
    return false;
  }
}

export async function status(userId: string, unlockToken?: string) {
  const row = await load(userId);
  return { enabled: row.totp_enabled, unlocked: await checkUnlock(unlockToken, userId) };
}

export async function startSetup(userId: string) {
  const row = await load(userId);
  if (row.totp_enabled) throw new AdminAuthError('Two-factor sign-in is already on');
  const secret = totp.newSecret();
  await pool.query('UPDATE users SET totp_pending = $2 WHERE id = $1', [userId, totp.encryptSecret(secret)]);
  const url = totp.otpauthUrl(secret, row.email);
  return { secret, otpauthUrl: url, qr: await QRCode.toDataURL(url, { margin: 1, width: 220 }) };
}

// Confirms the first code, turns 2FA on and returns recovery codes once.
export async function enable(userId: string, code: unknown) {
  const row = await load(userId);
  if (row.totp_enabled) throw new AdminAuthError('Two-factor sign-in is already on');
  if (!row.totp_pending) throw new AdminAuthError('Start the setup first');
  const secret = totp.decryptSecret(row.totp_pending);
  const step = totp.verifyCode(secret, String(code ?? ''));
  if (step === null) {
    await logEvent(userId, 'admin_2fa_failed', { during: 'setup' });
    throw new AdminAuthError('Wrong code. Check the time on your phone and try again.', 401);
  }
  const recovery = totp.newRecoveryCodes();
  await pool.query(
    `UPDATE users SET totp_secret = totp_pending, totp_pending = NULL, totp_enabled = true,
       totp_last_step = $2, totp_recovery = $3 WHERE id = $1`,
    [userId, step, recovery.map(totp.hashRecovery)]
  );
  await logEvent(userId, 'admin_2fa_enabled', {});
  return { recoveryCodes: recovery, unlock: issueUnlock(userId, row.token_version) };
}

// A 6-digit code (each time step usable once) or a one-time recovery code.
export async function unlock(userId: string, code: unknown) {
  const row = await load(userId);
  if (!row.totp_enabled || !row.totp_secret) throw new AdminAuthError('Turn on two-factor sign-in first');
  const value = String(code ?? '').trim();
  if (/^\d{6}$/.test(value)) {
    const step = totp.verifyCode(totp.decryptSecret(row.totp_secret), value);
    // Atomic replay guard: the step must be newer than the last one used.
    const ok = step !== null && (await pool.query(
      'UPDATE users SET totp_last_step = $2 WHERE id = $1 AND (totp_last_step IS NULL OR totp_last_step < $2) RETURNING 1',
      [userId, step]
    )).rows.length === 1;
    if (ok) {
      await logEvent(userId, 'admin_unlocked', { with: 'code' });
      return issueUnlock(userId, row.token_version);
    }
  } else if (/^[a-z2-7]{4}-[a-z2-7]{4}$/i.test(value)) {
    const h = totp.hashRecovery(value);
    const used = await pool.query(
      'UPDATE users SET totp_recovery = array_remove(totp_recovery, $2) WHERE id = $1 AND $2 = ANY(totp_recovery) RETURNING cardinality(totp_recovery) AS left',
      [userId, h]
    );
    if (used.rows.length === 1) {
      await logEvent(userId, 'admin_unlocked', { with: 'recovery code', left: used.rows[0].left });
      return issueUnlock(userId, row.token_version);
    }
  }
  await logEvent(userId, 'admin_2fa_failed', {});
  throw new AdminAuthError('Wrong code', 401);
}
