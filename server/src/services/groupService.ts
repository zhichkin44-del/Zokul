import { pool } from '../config/db';
import { ChatWithUsers } from '../types';
import * as chatModel from '../models/Chat';
import * as UserModel from '../models/User';
import { emitToChat, emitToUsers, joinUserToChat, removeUserFromChat } from '../socket';

const MAX_GROUP_SIZE = 100;

export class GroupError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 = 400) {
    super(message);
  }
}

// People can be invited freely; an AI agent only by the person who owns it.
export async function assertCanInvite(requesterId: string, userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  const found = new Map((await UserModel.findInvitees(userIds)).map((u) => [u.id, u]));
  for (const id of userIds) {
    const user = found.get(id);
    if (!user) throw new GroupError('User not found', 404);
    if (user.isAgent && user.ownerId !== requesterId) throw new GroupError('You can only add your own agents', 403);
  }
}

async function isOwnAgent(requesterId: string, userId: string): Promise<boolean> {
  const [user] = await UserModel.findInvitees([userId]);
  return !!user?.isAgent && user.ownerId === requesterId;
}

async function loadGroup(chatId: string): Promise<ChatWithUsers> {
  const chat = await chatModel.findChatById(chatId);
  if (!chat) throw new GroupError('Chat not found', 404);
  if (!chat.isGroup) throw new GroupError('This is not a group');
  return chat;
}

function requireCreator(chat: ChatWithUsers, requesterId: string): void {
  if (chat.creatorId !== requesterId) throw new GroupError('Only the group creator can do this', 403);
}

function cleanName(name: unknown): string {
  const value = typeof name === 'string' ? name.trim() : '';
  if (!value || value.length > 100) throw new GroupError('Group name must be 1-100 characters');
  return value;
}

export async function createGroup(
  creatorId: string,
  name: string,
  participantIds: string[]
): Promise<ChatWithUsers> {
  const cleanedName = cleanName(name);
  const others = [...new Set(participantIds.filter((id) => typeof id === 'string' && id !== creatorId))];
  const allIds = [creatorId, ...others];
  if (allIds.length > MAX_GROUP_SIZE) {
    throw new GroupError(`Group size cannot exceed ${MAX_GROUP_SIZE} participants`);
  }
  await assertCanInvite(creatorId, others);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const chatResult = await client.query(
      `INSERT INTO chats (name, is_group, creator_id) VALUES ($1, true, $2) RETURNING id, created_at`,
      [cleanedName, creatorId]
    );
    const chatId = chatResult.rows[0].id;
    for (const userId of allIds) {
      await client.query(
        'INSERT INTO chat_participants (chat_id, user_id) VALUES ($1, $2)',
        [chatId, userId]
      );
    }
    await client.query('COMMIT');
    const chat = await chatModel.findChatById(chatId);
    return chat!;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// The creator adds people (and their own agents); any member may bring in
// their own agent.
export async function addMember(chatId: string, requesterId: string, userId: string): Promise<void> {
  const chat = await loadGroup(chatId);
  if (chat.creatorId !== requesterId) {
    if (!chat.participantIds.includes(requesterId) || !(await isOwnAgent(requesterId, userId))) requireCreator(chat, requesterId);
  }
  if (chat.participantIds.includes(userId)) return;
  if (chat.participantIds.length >= MAX_GROUP_SIZE) throw new GroupError(`Group size cannot exceed ${MAX_GROUP_SIZE} participants`);
  await assertCanInvite(requesterId, [userId]);
  await pool.query(
    'INSERT INTO chat_participants (chat_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [chatId, userId]
  );
  joinUserToChat(userId, chatId);
  emitToUsers([userId], 'chat:new-room', { chatId });
  await emitToChat(chatId, 'chat:updated', { chatId });
}

// The creator removes others; anyone can remove themselves (leave) or their
// own agent. The creator cannot leave their own group: they delete it instead.
export async function removeMember(chatId: string, requesterId: string, userId: string): Promise<void> {
  const chat = await loadGroup(chatId);
  if (userId === requesterId) {
    if (chat.creatorId === requesterId) throw new GroupError('The creator cannot leave; delete the group instead', 403);
  } else if (!(chat.participantIds.includes(requesterId) && (await isOwnAgent(requesterId, userId)))) {
    requireCreator(chat, requesterId);
  }
  await pool.query(
    'DELETE FROM chat_participants WHERE chat_id = $1 AND user_id = $2',
    [chatId, userId]
  );
  removeUserFromChat(userId, chatId);
  emitToUsers([userId], 'chat:deleted', { chatId });
  await emitToChat(chatId, 'chat:updated', { chatId });
}

export async function renameGroup(chatId: string, requesterId: string, name: unknown): Promise<void> {
  const chat = await loadGroup(chatId);
  requireCreator(chat, requesterId);
  await chatModel.renameChat(chatId, cleanName(name));
  await emitToChat(chatId, 'chat:updated', { chatId });
}
