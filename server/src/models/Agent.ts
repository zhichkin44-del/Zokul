import { randomUUID } from 'crypto';
import { pool } from '../config/db';

export interface AgentRecord {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
  lastUsedAt?: string;
}

interface AgentRow {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
  last_used_at: string | null;
}

function toAgent(row: AgentRow): AgentRecord {
  return {
    id: row.id,
    name: row.name,
    ownerId: row.owner_id,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at || undefined,
  };
}

const AGENT_SELECT = `
  SELECT u.id, u.name, u.owner_id, u.created_at,
         (SELECT MAX(t.last_used_at) FROM agent_tokens t WHERE t.agent_id = u.id) AS last_used_at
  FROM users u
`;

// Agents are users that can never log in with a password: the stored hash
// is not a bcrypt hash, so every password comparison fails.
export async function createAgent(ownerId: string, name: string): Promise<AgentRecord> {
  const result = await pool.query(
    `INSERT INTO users (email, password_hash, name, is_agent, owner_id)
     VALUES ($1, '!agent', $2, true, $3)
     RETURNING id, name, owner_id, created_at, NULL::timestamptz AS last_used_at`,
    [`agent-${randomUUID()}@agents.zokul.local`, name, ownerId]
  );
  return toAgent(result.rows[0]);
}

export async function listByOwner(ownerId: string): Promise<AgentRecord[]> {
  const result = await pool.query(
    `${AGENT_SELECT} WHERE u.owner_id = $1 AND u.is_agent = true ORDER BY u.created_at`,
    [ownerId]
  );
  return result.rows.map(toAgent);
}

export async function findOwned(agentId: string, ownerId: string): Promise<AgentRecord | null> {
  const result = await pool.query(
    `${AGENT_SELECT} WHERE u.id = $1 AND u.owner_id = $2 AND u.is_agent = true`,
    [agentId, ownerId]
  );
  return result.rows[0] ? toAgent(result.rows[0]) : null;
}

export async function deleteAgent(agentId: string, ownerId: string): Promise<boolean> {
  const result = await pool.query(
    'DELETE FROM users WHERE id = $1 AND owner_id = $2 AND is_agent = true',
    [agentId, ownerId]
  );
  return (result.rowCount ?? 0) > 0;
}

// One active token per agent: issuing a new one revokes the old.
export async function replaceToken(agentId: string, tokenHash: string): Promise<void> {
  await pool.query('DELETE FROM agent_tokens WHERE agent_id = $1', [agentId]);
  await pool.query('INSERT INTO agent_tokens (agent_id, token_hash) VALUES ($1, $2)', [agentId, tokenHash]);
}

export async function findByTokenHash(tokenHash: string): Promise<AgentRecord | null> {
  const result = await pool.query(
    `UPDATE agent_tokens t SET last_used_at = NOW()
     FROM users u
     WHERE t.token_hash = $1 AND u.id = t.agent_id AND u.is_agent = true
     RETURNING u.id, u.name, u.owner_id, u.created_at, t.last_used_at`,
    [tokenHash]
  );
  return result.rows[0] ? toAgent(result.rows[0]) : null;
}

export interface HandoffRow {
  id: string;
  chat_id: string;
  sender_id: string;
  sender_name: string;
  payload: Record<string, unknown>;
  created_at: string;
}

// Handoff cards written by any agent of this owner, newest first.
// Handoffs an agent may pick up: from its owner's other agents (any chat), or
// posted in a chat the agent itself is in (a shared team room). Never its own.
export async function listHandoffs(ownerId: string, agentId: string, onlyOpen: boolean, limit: number): Promise<HandoffRow[]> {
  const result = await pool.query(
    `SELECT m.id, m.chat_id, m.sender_id, u.name AS sender_name, m.payload, m.created_at
     FROM messages m
     JOIN users u ON u.id = m.sender_id
     WHERE m.kind = 'handoff' AND m.deleted_at IS NULL
       AND m.sender_id <> $4
       AND (u.owner_id = $1 OR m.chat_id IN (SELECT chat_id FROM chat_participants WHERE user_id = $4))
       AND ($2::boolean = false OR m.payload->>'claimedBy' IS NULL)
     ORDER BY m.created_at DESC
     LIMIT $3`,
    [ownerId, onlyOpen, limit, agentId]
  );
  return result.rows;
}
