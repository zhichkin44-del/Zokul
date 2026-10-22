import { pool } from '../config/db';
import { logger } from '../utils/logger';

export type AuditAction =
  | 'login' | 'login_failed' | 'login_blocked' | 'register' | 'password_changed'
  | 'invite_created' | 'invite_revoked' | 'user_blocked' | 'user_unblocked'
  | 'agent_created' | 'agent_token_rotated' | 'agent_deleted';

// Security journal shown in the admin panel. Never fails the action itself.
export async function logEvent(actorId: string | null, action: AuditAction, details?: Record<string, unknown>): Promise<void> {
  try {
    await pool.query('INSERT INTO audit_log (actor_id, action, details) VALUES ($1, $2, $3)', [actorId, action, details ? JSON.stringify(details) : null]);
  } catch (err) {
    logger(`Audit log write failed (${action}): ${err}`, 'error');
  }
}

export async function recentEvents(limit = 50) {
  const result = await pool.query(
    `SELECT a.id, a.at, a.action, a.details, u.name AS actor_name
     FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
     ORDER BY a.at DESC LIMIT $1`,
    [Math.min(Math.max(limit, 1), 200)]
  );
  return result.rows.map((r) => ({ id: String(r.id), at: r.at, action: r.action, details: r.details, actorName: r.actor_name }));
}
