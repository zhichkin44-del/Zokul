import * as MessageModel from '../models/Message';
import * as ChatModel from '../models/Chat';
import * as UserModel from '../models/User';
import { FileAttachment, Message, MessageKind, ReadReceipt } from '../types';

const MAX_TEXT = 10000;
const MEDIA = {
  image: /^\/uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/,
  voice: /^\/uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webm|ogg|wav|mp3|m4a|aac)$/,
};

function isOwnMedia(url: unknown, type: keyof typeof MEDIA): boolean {
  return typeof url === 'string' && MEDIA[type].test(url);
}
import { logger } from '../utils/logger';
import { sendPushNotification } from './notificationService';

export async function getMessages(
  chatId: string,
  offset?: number,
  limit?: number
): Promise<Message[]> {
  return MessageModel.findByChatId(chatId, offset || 0, limit || 50);
}

export async function createMessage(
  chatId: string,
  senderId: string,
  text?: string,
  imageUrl?: string,
  voiceUrl?: string,
  voiceDuration?: number,
  replyToId?: string,
  imageUrls?: string[],
  kind: MessageKind = 'text',
  payload?: Record<string, unknown>,
  file?: FileAttachment
): Promise<Message> {
  if (!text && !imageUrl && !voiceUrl && !imageUrls?.length && !file) {
    throw new Error('Message must have text, image, or voice');
  }
  // Media must be our own uploads: an outside URL would make every reader's
  // browser contact a third-party server (IP / read tracking).
  if (text !== undefined && (typeof text !== 'string' || text.length > MAX_TEXT)) throw new Error('Message is too long');
  if (imageUrl !== undefined && !isOwnMedia(imageUrl, 'image')) throw new Error('Invalid image');
  if (voiceUrl !== undefined && !isOwnMedia(voiceUrl, 'voice')) throw new Error('Invalid voice message');
  if (imageUrls !== undefined && (!Array.isArray(imageUrls) || imageUrls.length > 10 || !imageUrls.every((u) => isOwnMedia(u, 'image')))) {
    throw new Error('Invalid image');
  }
  // A reply can only quote a message from the same chat.
  if (replyToId !== undefined && replyToId !== null) {
    const target = await MessageModel.findById(String(replyToId));
    if (!target || target.chatId !== chatId) throw new Error('Invalid reply');
  }
  const message = await MessageModel.create(chatId, senderId, text, imageUrl, voiceUrl, voiceDuration, replyToId, imageUrls, kind, payload, file);
  logger(`Message created in chat ${chatId}`);

  const state = (payload as { state?: string } | undefined)?.state;
  const silent = kind === 'status' && (state === 'working' || state === 'info');
  try {
    const chat = silent ? null : await ChatModel.findChatById(chatId);
    const sender = silent ? null : await UserModel.findById(senderId);
    if (chat && sender) {
      const body = text || (imageUrl || imageUrls?.length ? 'Photo' : voiceUrl ? 'Voice' : file ? `📎 ${file.name}` : '');
      const muted = new Set(await ChatModel.getMutedUserIds(chatId));
      for (const pid of chat.participantIds) {
        if (pid !== senderId && !muted.has(pid)) {
          sendPushNotification(pid, sender.name, body, { chatId, messageId: message.id });
        }
      }
    }
  } catch {
    // push is best-effort
  }

  return message;
}

export async function editMessage(
  messageId: string,
  text: string,
  userId: string
): Promise<Message> {
  if (!text.trim()) throw new Error('Message text is required');
  const existing = await MessageModel.findById(messageId);
  if (!existing) throw new Error('Message not found');
  if (existing.senderId !== userId) throw new Error('Not authorized to edit this message');
  const message = await MessageModel.updateMessage(messageId, text);
  if (!message) throw new Error('Message not found');
  return message;
}

export async function searchMessages(
  chatId: string,
  query: string,
  limit?: number,
  offset?: number
): Promise<Message[]> {
  return MessageModel.search(chatId, query, limit || 50, offset || 0);
}

export async function deleteMessage(
  messageId: string,
  userId: string
): Promise<{ chatId: string }> {
  const msg = await MessageModel.findById(messageId);
  if (!msg) throw new Error('Message not found');
  if (msg.senderId !== userId) throw new Error('Not authorized to delete this message');
  const deleted = await MessageModel.softDelete(messageId);
  if (!deleted) throw new Error('Message not found');
  return { chatId: msg.chatId };
}

export async function markChatRead(chatId: string, userId: string): Promise<string[]> {
  return MessageModel.markChatRead(chatId, userId);
}

export async function getReadReceipts(messageIds: string[], viewerUserId: string): Promise<ReadReceipt[]> {
  return MessageModel.getReadReceipts(messageIds, viewerUserId);
}
