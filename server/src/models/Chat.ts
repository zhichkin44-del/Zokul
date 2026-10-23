import { pool } from '../config/db';
import { ChatWithUsers, ChatRow, Message, User } from '../types';

function toUser(row: ChatRow): User {
  return {
    id: row.user_id,
    // Other members' emails are private; the client never needs them.
    email: '',
    name: row.user_name,
    avatarUrl: row.user_avatar_url || undefined,
    createdAt: row.user_created_at,
    isAgent: row.user_is_agent || undefined,
    lastSeenAt: row.user_last_seen_at || undefined,
  };
}

function toMessage(row: ChatRow): Message | undefined {
  if (!row.last_message_id) return undefined;
  return {
    id: row.last_message_id,
    chatId: row.id,
    senderId: row.last_message_sender_id || '',
    text: row.last_message_text || undefined,
    // The list shows a file icon and the name; the file itself is not needed here.
    file: row.last_message_file_name ? { url: '', name: row.last_message_file_name, size: 0, mime: '' } : undefined,
    imageUrl: row.last_message_image_url || undefined,
    createdAt: row.last_message_created_at || row.created_at,
  };
}

const CHAT_QUERY = `
  SELECT c.id, c.name, c.is_group, c.created_at, c.creator_id,
         lm.id as last_message_id,
         lm.text as last_message_text,
         lm.image_url as last_message_image_url,
         lm.created_at as last_message_created_at,
         lm.sender_id as last_message_sender_id,
         lm.file_name as last_message_file_name,
         u.id as user_id, u.email as user_email,
         u.name as user_name, u.avatar_url as user_avatar_url,
         u.created_at as user_created_at, u.is_agent as user_is_agent,
         u.last_seen_at as user_last_seen_at, cp.muted as user_muted
  FROM chats c
  JOIN chat_participants cp ON cp.chat_id = c.id
  JOIN users u ON u.id = cp.user_id
  LEFT JOIN LATERAL (
    SELECT id, text, image_url, file_name, created_at, sender_id
    FROM messages
    WHERE chat_id = c.id AND deleted_at IS NULL
    ORDER BY created_at DESC
    LIMIT 1
  ) lm ON true
`;

// `viewerId` fills in that user's own settings (muted) on each chat.
async function findChats(query: string, params: string[], viewerId?: string): Promise<ChatWithUsers[]> {
  const result = await pool.query(query, params);
  const chatMap = new Map<string, ChatWithUsers>();
  for (const row of result.rows as ChatRow[]) {
    if (!chatMap.has(row.id)) {
      chatMap.set(row.id, {
        id: row.id,
        name: row.name || undefined,
        isGroup: row.is_group || false,
        creatorId: row.creator_id || undefined,
        participantIds: [],
        participants: [],
        createdAt: row.created_at,
        lastMessage: toMessage(row),
      });
    }
    const chat = chatMap.get(row.id)!;
    if (viewerId && row.user_id === viewerId) chat.muted = row.user_muted || false;
    chat.participantIds.push(row.user_id);
    chat.participants.push(toUser(row));
  }
  return Array.from(chatMap.values());
}

export async function findChatsByUserId(userId: string): Promise<ChatWithUsers[]> {
  return findChats(
    `${CHAT_QUERY}
     WHERE c.id IN (
       SELECT chat_id FROM chat_participants WHERE user_id = $1
     )
     ORDER BY COALESCE(lm.created_at, c.created_at) DESC`,
    [userId],
    userId
  );
}

export async function findChatById(id: string): Promise<ChatWithUsers | null> {
  const chats = await findChats(
    `${CHAT_QUERY} WHERE c.id = $1`,
    [id]
  );
  return chats[0] || null;
}

// The one-to-one chat of these two users. Groups they share do not count.
export async function findExistingChat(userId1: string, userId2: string): Promise<ChatWithUsers | null> {
  const chats = await findChats(
    `${CHAT_QUERY}
     WHERE c.id IN (
       SELECT cp1.chat_id
       FROM chat_participants cp1
       JOIN chat_participants cp2 ON cp1.chat_id = cp2.chat_id
       JOIN chats dc ON dc.id = cp1.chat_id AND dc.is_group IS NOT TRUE
       WHERE cp1.user_id = $1 AND cp2.user_id = $2
     )`,
    [userId1, userId2]
  );
  return chats[0] || null;
}

export async function createChat(userId1: string, userId2: string): Promise<ChatWithUsers> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const chatResult = await client.query(
      'INSERT INTO chats DEFAULT VALUES RETURNING id, created_at'
    );
    const chatId = chatResult.rows[0].id;
    await client.query(
      'INSERT INTO chat_participants (chat_id, user_id) VALUES ($1, $2), ($1, $3)',
      [chatId, userId1, userId2]
    );
    await client.query('COMMIT');
    const chat = await findChatById(chatId);
    return chat!;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function setMuted(chatId: string, userId: string, muted: boolean): Promise<void> {
  await pool.query('UPDATE chat_participants SET muted = $3 WHERE chat_id = $1 AND user_id = $2', [chatId, userId, muted]);
}

export async function getMutedUserIds(chatId: string): Promise<string[]> {
  const result = await pool.query('SELECT user_id FROM chat_participants WHERE chat_id = $1 AND muted', [chatId]);
  return result.rows.map((r: { user_id: string }) => r.user_id);
}

export async function renameChat(chatId: string, name: string): Promise<void> {
  await pool.query('UPDATE chats SET name = $2 WHERE id = $1 AND is_group = true', [chatId, name]);
}

export async function removeChat(chatId: string): Promise<void> {
  await pool.query('DELETE FROM chats WHERE id = $1', [chatId]);
}
