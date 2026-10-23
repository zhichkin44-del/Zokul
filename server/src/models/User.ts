import { pool } from '../config/db';
import { User, UserRow } from '../types';

function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatar_url || undefined,
    createdAt: row.created_at,
    isAgent: row.is_agent || undefined,
    role: row.role,
  };
}

export async function findByEmail(email: string): Promise<(User & { passwordHash: string; tokenVersion: number; blocked: boolean }) | null> {
  const result = await pool.query('SELECT * FROM users WHERE lower(email) = lower($1)', [email]);
  const row: UserRow | undefined = result.rows[0];
  if (!row) return null;
  return { ...toUser(row), passwordHash: row.password_hash, tokenVersion: row.token_version, blocked: row.blocked === true };
}

export async function findById(id: string): Promise<User | null> {
  const result = await pool.query(
    'SELECT id, email, name, avatar_url, created_at, is_agent, last_seen_at, role FROM users WHERE id = $1',
    [id]
  );
  const row = result.rows[0] as UserRow | undefined;
  if (!row) return null;
  return {
    id: row.id, email: row.email, name: row.name,
    avatarUrl: row.avatar_url || undefined, createdAt: row.created_at,
    isAgent: row.is_agent || undefined,
    lastSeenAt: row.last_seen_at || undefined,
    role: row.role,
  };
}

export async function search(query: string, excludeUserId: string, limit: number = 10): Promise<{ id: string; name: string; avatarUrl?: string }[]> {
  const result = await pool.query(
    `SELECT id, name, avatar_url FROM users
     WHERE (email ILIKE $1 OR name ILIKE $1) AND id != $2 AND is_agent IS NOT TRUE AND blocked = false AND deleted_at IS NULL
     LIMIT $3`,
    [`%${query}%`, excludeUserId, limit]
  );
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    avatarUrl: row.avatar_url || undefined,
  }));
}

export async function setLastSeen(userId: string): Promise<string> {
  const result = await pool.query('UPDATE users SET last_seen_at = NOW() WHERE id = $1 RETURNING last_seen_at', [userId]);
  return result.rows[0]?.last_seen_at;
}

export async function findInvitees(ids: string[]): Promise<{ id: string; isAgent: boolean; ownerId: string | null }[]> {
  const result = await pool.query('SELECT id, is_agent, owner_id FROM users WHERE id = ANY($1::uuid[])', [ids]);
  return result.rows.map((r: { id: string; is_agent: boolean; owner_id: string | null }) => ({ id: r.id, isAgent: r.is_agent, ownerId: r.owner_id }));
}

// People who share at least one chat with this user (presence is only shown to them).
export async function findContactIds(userId: string): Promise<string[]> {
  const result = await pool.query(
    `SELECT DISTINCT cp2.user_id
     FROM chat_participants cp1
     JOIN chat_participants cp2 ON cp2.chat_id = cp1.chat_id AND cp2.user_id <> cp1.user_id
     WHERE cp1.user_id = $1`,
    [userId]
  );
  return result.rows.map((r: { user_id: string }) => r.user_id);
}

export async function create(email: string, passwordHash: string, name: string): Promise<User> {
  const result = await pool.query(
    `INSERT INTO users (email, password_hash, name)
     VALUES ($1, $2, $3)
     RETURNING id, email, name, avatar_url, created_at, 0 as token_version`,
    [email, passwordHash, name]
  );
  return toUser(result.rows[0]);
}

export async function updateProfile(
  userId: string,
  data: { name?: string; avatarUrl?: string }
): Promise<User | null> {
  const sets: string[] = [];
  const params: string[] = [];
  if (data.name !== undefined) {
    sets.push('name = $' + (params.length + 1));
    params.push(data.name);
  }
  if (data.avatarUrl !== undefined) {
    sets.push('avatar_url = $' + (params.length + 1));
    params.push(data.avatarUrl);
  }
  if (sets.length === 0) return findById(userId);
  params.push(userId);
  const result = await pool.query(
    `UPDATE users SET ${sets.join(', ')} WHERE id = $${params.length}
     RETURNING id, email, name, avatar_url, created_at, 0 as token_version`,
    params
  );
  return result.rows[0] ? toUser(result.rows[0]) : null;
}

export async function findByIdWithPassword(id: string): Promise<{ passwordHash: string } | null> {
  const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [id]);
  const row = result.rows[0];
  return row ? { passwordHash: row.password_hash } : null;
}

export async function updatePassword(userId: string, passwordHash: string): Promise<void> {
  await pool.query(
    'UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2',
    [passwordHash, userId]
  );
}

// null when the account no longer exists or is blocked: its sessions are dead.
export async function getTokenVersion(userId: string): Promise<number | null> {
  const result = await pool.query('SELECT token_version, blocked FROM users WHERE id = $1', [userId]);
  const row = result.rows[0];
  if (!row || row.blocked) return null;
  return row.token_version ?? 0;
}

export async function isAdmin(userId: string): Promise<boolean> {
  const result = await pool.query("SELECT 1 FROM users WHERE id = $1 AND role = 'admin' AND blocked = false", [userId]);
  return result.rows.length > 0;
}
