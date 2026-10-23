import { readdir, stat } from 'fs/promises';
import path from 'path';
import { pool } from '../config/db';
import { config } from '../config/app';
import * as presenceService from './presenceService';
import { logEvent } from './auditService';
import { emitToUsers } from '../socket';

export class AdminError extends Error {
  constructor(message: string, readonly status: 400 | 404 = 400) {
    super(message);
  }
}

async function folderSize(dir: string): Promise<number> {
  let total = 0;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    total += entry.isDirectory() ? await folderSize(full) : (await stat(full).catch(() => ({ size: 0 }))).size;
  }
  return total;
}

export async function overview() {
  const counts = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM users WHERE is_agent IS NOT TRUE)::int AS people,
      (SELECT COUNT(*) FROM users WHERE is_agent)::int AS agents,
      (SELECT COUNT(*) FROM messages WHERE created_at >= date_trunc('day', NOW()))::int AS messages_today,
      (SELECT COUNT(*) FROM messages m JOIN users u ON u.id = m.sender_id
         WHERE u.is_agent AND m.created_at >= date_trunc('day', NOW()))::int AS agent_messages_today,
      (SELECT COUNT(*) FROM messages WHERE kind = 'question' AND deleted_at IS NULL
         AND payload->>'answer' IS NULL AND payload->>'cancelled' IS NULL)::int AS open_questions,
      (SELECT COUNT(*) FROM invites WHERE NOT revoked AND expires_at > NOW() AND uses < max_uses)::int AS active_invites
  `);
  const online = (await presenceService.getAllOnlineUserIds()).length;
  const c = counts.rows[0];
  return {
    people: c.people,
    peopleOnline: online,
    agents: c.agents,
    openQuestions: c.open_questions,
    messagesToday: c.messages_today,
    agentMessagesToday: c.agent_messages_today,
    activeInvites: c.active_invites,
    uploadsBytes: await folderSize(config.uploadDir),
  };
}

export async function listUsers() {
  const result = await pool.query(`
    SELECT id, name, email, role, blocked, created_at, last_seen_at, deleted_at
    FROM users WHERE is_agent IS NOT TRUE ORDER BY deleted_at NULLS FIRST, created_at`);
  return result.rows.map((r) => ({
    id: r.id, name: r.name, email: r.deleted_at ? '' : r.email, role: r.role, blocked: r.blocked,
    deleted: !!r.deleted_at, createdAt: r.created_at, lastSeenAt: r.last_seen_at,
  }));
}

// Blocking also ends every session of that person right away.
export async function setBlocked(adminId: string, userId: string, blocked: boolean): Promise<void> {
  if (userId === adminId) throw new AdminError('You cannot block yourself');
  const result = await pool.query(
    `UPDATE users SET blocked = $2, token_version = token_version + 1
     WHERE id = $1 AND is_agent IS NOT TRUE AND role <> 'admin' AND deleted_at IS NULL RETURNING name`,
    [userId, blocked]
  );
  if (result.rows.length === 0) throw new AdminError('User not found', 404);
  if (blocked) emitToUsers([userId], 'session:revoked', {});
  await logEvent(adminId, blocked ? 'user_blocked' : 'user_unblocked', { name: result.rows[0].name });
}

export async function listAgents() {
  const result = await pool.query(`
    SELECT a.id, a.name, a.created_at, o.name AS owner_name,
           (SELECT MAX(t.last_used_at) FROM agent_tokens t WHERE t.agent_id = a.id) AS last_used_at
    FROM users a JOIN users o ON o.id = a.owner_id
    WHERE a.is_agent AND a.deleted_at IS NULL ORDER BY a.created_at`);
  return result.rows.map((r) => ({ id: r.id, name: r.name, ownerName: r.owner_name, createdAt: r.created_at, lastUsedAt: r.last_used_at }));
}

export async function health() {
  const database = await pool.query('SELECT 1').then(() => true).catch(() => false);
  const redis = await presenceService.getAllOnlineUserIds().then(() => true).catch(() => false);
  return { database, redis, push: Boolean(config.vapidPublicKey && config.vapidPrivateKey) };
}
