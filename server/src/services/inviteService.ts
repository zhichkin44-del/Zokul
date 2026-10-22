import { createHash, randomBytes } from 'crypto';
import type { PoolClient } from 'pg';
import { pool } from '../config/db';
import { logEvent } from './auditService';

export class InviteError extends Error {}

const hash = (code: string) => createHash('sha256').update(code).digest('hex');

// The code is shown once to the admin (as a link); only its hash is stored.
export async function createInvite(adminId: string, raw: { label?: unknown; maxUses?: unknown; expiresInDays?: unknown }) {
  const label = typeof raw.label === 'string' ? raw.label.trim().slice(0, 100) : '';
  if (!label) throw new InviteError('Give the invite a name, e.g. who it is for');
  const maxUses = Number(raw.maxUses ?? 1);
  const days = Number(raw.expiresInDays ?? 7);
  if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 50) throw new InviteError('Uses must be between 1 and 50');
  if (!Number.isInteger(days) || days < 1 || days > 30) throw new InviteError('Expiry must be 1-30 days');
  const code = `inv_${randomBytes(18).toString('base64url')}`;
  const result = await pool.query(
    `INSERT INTO invites (code_hash, label, created_by, max_uses, expires_at)
     VALUES ($1, $2, $3, $4, NOW() + ($5 || ' days')::interval)
     RETURNING id, label, max_uses, uses, expires_at, created_at`,
    [hash(code), label, adminId, maxUses, String(days)]
  );
  await logEvent(adminId, 'invite_created', { label, maxUses, days });
  return { code, invite: toInvite(result.rows[0]) };
}

function toInvite(r: { id: string; label: string; max_uses: number; uses: number; expires_at: string; created_at: string; revoked?: boolean }) {
  const expired = new Date(r.expires_at).getTime() < Date.now();
  const state = r.revoked ? 'revoked' : expired ? 'expired' : r.uses >= r.max_uses ? 'used' : 'active';
  return { id: r.id, label: r.label, maxUses: r.max_uses, uses: r.uses, expiresAt: r.expires_at, createdAt: r.created_at, state };
}

export async function listInvites() {
  const result = await pool.query('SELECT id, label, max_uses, uses, expires_at, created_at, revoked FROM invites ORDER BY created_at DESC LIMIT 100');
  return result.rows.map(toInvite);
}

export async function revokeInvite(adminId: string, id: string): Promise<boolean> {
  const result = await pool.query('UPDATE invites SET revoked = true WHERE id = $1 AND revoked = false RETURNING label', [id]);
  if (result.rows.length === 0) return false;
  await logEvent(adminId, 'invite_revoked', { label: result.rows[0].label });
  return true;
}

// Called inside the registration transaction: one use, atomically, or nothing.
export async function consumeInvite(client: PoolClient, code: unknown): Promise<string> {
  if (typeof code !== 'string' || !code.startsWith('inv_')) throw new InviteError('A valid invite is required to join this server');
  const result = await client.query(
    `UPDATE invites SET uses = uses + 1
     WHERE code_hash = $1 AND revoked = false AND expires_at > NOW() AND uses < max_uses
     RETURNING id`,
    [hash(code)]
  );
  if (result.rows.length === 0) throw new InviteError('This invite is invalid, used up or expired');
  return result.rows[0].id;
}
