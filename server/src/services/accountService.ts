import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { pool } from '../config/db';
import { endSessions } from '../socket';
import { logEvent } from './auditService';
import { validatePassword, SALT_ROUNDS } from './authService';

// Password reset links issued by the owner, and self-service account deletion.

export class AccountError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 = 400) {
    super(message);
  }
}

export const RESET_TTL_MS = 24 * 60 * 60 * 1000;
const hash = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

// One live link per person: a new link replaces the old one. Not for the
// owner (owner recovery is server-only) and not for agents.
export async function issueResetLink(adminId: string, userId: string) {
  const r = await pool.query(
    `SELECT name FROM users WHERE id = $1 AND is_agent IS NOT TRUE AND role <> 'admin' AND deleted_at IS NULL`,
    [userId]
  );
  if (!r.rows[0]) throw new AccountError('User not found', 404);
  const token = `rst_${crypto.randomBytes(32).toString('base64url')}`;
  const expiresAt = new Date(Date.now() + RESET_TTL_MS);
  await pool.query('DELETE FROM password_resets WHERE user_id = $1', [userId]);
  await pool.query(
    'INSERT INTO password_resets (user_id, token_hash, expires_at, created_by) VALUES ($1, $2, $3, $4)',
    [userId, hash(token), expiresAt, adminId]
  );
  await logEvent(adminId, 'password_reset_issued', { name: r.rows[0].name });
  return { token, expiresAt };
}

function looksLikeToken(token: unknown): token is string {
  return typeof token === 'string' && /^rst_[A-Za-z0-9_-]{43}$/.test(token);
}

export async function checkResetLink(token: unknown) {
  if (!looksLikeToken(token)) throw new AccountError('This link is invalid or expired');
  const r = await pool.query(
    `SELECT u.name FROM password_resets p JOIN users u ON u.id = p.user_id
     WHERE p.token_hash = $1 AND p.used_at IS NULL AND p.expires_at > NOW() AND u.deleted_at IS NULL`,
    [hash(token)]
  );
  if (!r.rows[0]) throw new AccountError('This link is invalid or expired');
  return { name: r.rows[0].name as string };
}

// Uses the link exactly once; the new password signs the person out everywhere.
export async function useResetLink(token: unknown, password: unknown) {
  if (!looksLikeToken(token)) throw new AccountError('This link is invalid or expired');
  validatePassword(password);
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const used = await client.query(
      `UPDATE password_resets p SET used_at = NOW() FROM users u
       WHERE p.token_hash = $1 AND p.used_at IS NULL AND p.expires_at > NOW() AND u.id = p.user_id AND u.deleted_at IS NULL
       RETURNING p.user_id`,
      [hash(token)]
    );
    if (!used.rows[0]) throw new AccountError('This link is invalid or expired');
    const userId = used.rows[0].user_id as string;
    await client.query('UPDATE users SET password_hash = $2, token_version = token_version + 1 WHERE id = $1', [userId, passwordHash]);
    await client.query('COMMIT');
    endSessions(userId);
    await logEvent(userId, 'password_reset_used', {});
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// The person disappears, the conversation stays: messages remain in the chats
// under "Deleted account"; name, email, avatar, password, push subscriptions,
// reset links and the person's agents (and their keys) are wiped.
export async function deleteAccount(userId: string, password: unknown) {
  const r = await pool.query('SELECT name, role, password_hash FROM users WHERE id = $1 AND deleted_at IS NULL', [userId]);
  const row = r.rows[0];
  if (!row) throw new AccountError('User not found', 404);
  if (!(await bcrypt.compare(String(password ?? ''), row.password_hash))) throw new Error('Current password is incorrect');
  if (row.role === 'admin') throw new AccountError('The owner cannot delete the account. Transfer ownership on the server first.', 403);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const agents = await client.query(
      `UPDATE users SET blocked = true, deleted_at = NOW(), token_version = token_version + 1
       WHERE owner_id = $1 AND is_agent RETURNING id`,
      [userId]
    );
    await client.query('DELETE FROM agent_tokens WHERE agent_id = ANY($1::uuid[])', [agents.rows.map((a) => a.id)]);
    await client.query(
      `UPDATE users SET name = 'Deleted account', email = 'deleted-' || id || '@deleted.invalid',
         password_hash = '!', avatar_url = NULL, blocked = true, deleted_at = NOW(),
         token_version = token_version + 1, last_seen_at = NULL
       WHERE id = $1`,
      [userId]
    );
    await client.query('DELETE FROM push_subscriptions WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM password_resets WHERE user_id = $1', [userId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  endSessions(userId);
  await logEvent(userId, 'account_deleted', { name: row.name });
}
