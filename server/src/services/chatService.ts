import * as ChatModel from '../models/Chat';
import { assertCanInvite } from './groupService';
import { ChatWithUsers } from '../types';
import { logger } from '../utils/logger';

export async function getUserChats(userId: string): Promise<ChatWithUsers[]> {
  return ChatModel.findChatsByUserId(userId);
}

export async function createChat(userId: string, participantId: string): Promise<ChatWithUsers> {
  if (userId === participantId) {
    throw new Error('Cannot create chat with yourself');
  }
  // Someone else's AI agent cannot be messaged directly.
  await assertCanInvite(userId, [participantId]);
  const existing = await ChatModel.findExistingChat(userId, participantId);
  if (existing) {
    return existing;
  }
  const userChats = await ChatModel.findChatsByUserId(userId);
  if (userChats.length >= 500) {
    throw new Error('Chat limit reached (max 500)');
  }
  const chat = await ChatModel.createChat(userId, participantId);
  logger(`Chat created: ${chat.id}`);
  return chat;
}

export async function getChatById(chatId: string): Promise<ChatWithUsers | null> {
  return ChatModel.findChatById(chatId);
}

export function setMuted(chatId: string, userId: string, muted: boolean): Promise<void> {
  return ChatModel.setMuted(chatId, userId, muted);
}

export async function deleteChat(chatId: string, userId: string): Promise<void> {
  const chat = await ChatModel.findChatById(chatId);
  if (!chat) throw new Error('Chat not found');
  if (!chat.participantIds.includes(userId)) throw new Error('Not a participant');
  if (chat.isGroup && chat.creatorId && chat.creatorId !== userId) {
    throw new Error('Only the group creator can delete this chat');
  }
  await ChatModel.removeChat(chatId);
}
