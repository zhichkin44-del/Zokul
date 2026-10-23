import { Server as HTTPServer } from 'http';
import { Server, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { verifyToken } from '../services/authService';
import * as messageService from '../services/messageService';
import * as chatService from '../services/chatService';
import * as chatModel from '../models/Chat';
import * as UserModel from '../models/User';
import * as presenceService from '../services/presenceService';
import * as agentService from '../services/agentService';
import { validateFileRef } from '../services/fileService';
import { logger } from '../utils/logger';
import { config } from '../config/app';
import { getRedisPubSub } from '../config/redis';

const HEARTBEAT_TIMEOUT = 35000;
let ioInstance: Server | null = null;

// For messages created outside a socket handler (agent REST API). Like
// message:send, it first puts every participant's open sockets into the room:
// clients leave a chat's room when they switch away from it, and must still
// get its updates for the chat list and unread counters.
export async function emitToChat(chatId: string, event: string, data: unknown): Promise<void> {
  if (!ioInstance) return;
  const chat = await chatModel.findChatById(chatId);
  for (const pid of chat?.participantIds ?? []) joinUserToChat(pid, chatId);
  ioInstance.to(`chat:${chatId}`).emit(event, data);
}

export function removeUserFromChat(userId: string, chatId: string): void {
  for (const socketId of userSockets.get(userId) ?? []) {
    ioInstance?.in(socketId).socketsLeave(`chat:${chatId}`);
  }
}

export function emitToUsers(userIds: Iterable<string>, event: string, data: unknown): void {
  for (const uid of userIds) {
    for (const socketId of userSockets.get(uid) ?? []) ioInstance?.to(socketId).emit(event, data);
  }
}

// Blocked, deleted or password reset: tell the open apps, then cut their
// sockets so a client that ignores the notice keeps nothing open.
export function endSessions(userId: string): void {
  emitToUsers([userId], 'session:revoked', {});
  const ids = [...(userSockets.get(userId) ?? [])];
  setTimeout(() => {
    for (const socketId of ids) ioInstance?.sockets.sockets.get(socketId)?.disconnect(true);
  }, 150);
}

// A chat created over REST (e.g. a new agent): put the user's open sockets
// into its room so they receive its messages without reconnecting.
export function joinUserToChat(userId: string, chatId: string): void {
  for (const socketId of userSockets.get(userId) ?? []) {
    ioInstance?.in(socketId).socketsJoin(`chat:${chatId}`);
  }
}
const userSockets = new Map<string, Set<string>>();
const messageRateLimits = new Map<string, number[]>();
const RATE_LIMIT_WINDOW = 1000;
const RATE_LIMIT_MAX = 5;
const CONNECT_RATE_LIMIT_WINDOW = 10 * 1000;
const CONNECT_RATE_LIMIT_MAX = 30;
const connectRateLimits = new Map<string, number[]>();

// Drop rate-limit entries nobody used in the last minute, so these maps cannot
// grow without bound (one entry per IP / user ever seen).
setInterval(() => {
  const cutoff = Date.now() - 60_000;
  for (const map of [messageRateLimits, connectRateLimits]) {
    for (const [key, stamps] of map) {
      if (!stamps.some((t) => t > cutoff)) map.delete(key);
    }
  }
}, 60_000).unref();

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const timestamps = messageRateLimits.get(userId) || [];
  const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW);
  if (recent.length >= RATE_LIMIT_MAX) return false;
  recent.push(now);
  messageRateLimits.set(userId, recent);
  return true;
}

interface AuthSocket extends Socket {
  userId: string;
  userName: string;
}

async function ensureChatParticipant(chatId: string, userId: string): Promise<boolean> {
  const chat = await chatModel.findChatById(chatId);
  return !!chat && chat.participantIds.includes(userId);
}

export function setupSocket(httpServer: HTTPServer): Server {
  const { pubClient, subClient } = getRedisPubSub();
  const io = new Server(httpServer, {
    cors: { origin: config.corsOrigin, credentials: true },
    pingTimeout: HEARTBEAT_TIMEOUT,
    adapter: createAdapter(pubClient, subClient),
  });
  ioInstance = io;

  io.use((socket: Socket, next) => {
    const ip = socket.handshake.address;
    const now = Date.now();
    const timestamps = connectRateLimits.get(ip) || [];
    const recent = timestamps.filter((t) => now - t < CONNECT_RATE_LIMIT_WINDOW);
    if (recent.length >= CONNECT_RATE_LIMIT_MAX) {
      return next(new Error('Connection rate limit exceeded'));
    }
    recent.push(now);
    connectRateLimits.set(ip, recent);
    next();
  });

  io.use(async (socket: Socket, next) => {
    const cookieToken = socket.handshake.headers.cookie
      ?.split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith('token='))
      ?.split('=')[1];
    const token = socket.handshake.auth?.token || cookieToken;
    if (!token) {
      return next(new Error('Authentication required'));
    }
    try {
      const decoded = verifyToken(token);
      const user = await UserModel.findById(decoded.userId);
      if (!user) {
        return next(new Error('User not found'));
      }
      // A password change or logout-everywhere bumps token_version.
      const version = await UserModel.getTokenVersion(decoded.userId);
      if (version === null || decoded.tokenVersion === undefined || decoded.tokenVersion < version) {
        return next(new Error('Session revoked'));
      }
      (socket as AuthSocket).userId = decoded.userId;
      (socket as AuthSocket).userName = user.name;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', async (socket: Socket) => {
    const authSocket = socket as AuthSocket;
    const userId = authSocket.userId;
    const userName = authSocket.userName;
    logger(`Socket connected: user ${userId}`);

    if (!userSockets.has(userId)) {
      userSockets.set(userId, new Set());
    }
    userSockets.get(userId)!.add(socket.id);

    // Event handlers are registered synchronously below; presence and room
    // setup runs afterwards (initSocketSession) so that events the client
    // emits right after connecting (chat:read on resume, etc.) are not lost.

    socket.on('heartbeat', async () => {
      await presenceService.setOnline(userId);
    });

    socket.on('chat:join', async (chatId: string) => {
      const allowed = await ensureChatParticipant(chatId, userId);
      if (!allowed) {
        socket.emit('error', { message: 'Forbidden' });
        return;
      }
      socket.join(`chat:${chatId}`);
      logger(`Socket ${socket.id} joined chat room ${chatId}`);
    });

    socket.on('message:send', async (data: { chatId: string; text?: string; imageUrl?: string; imageUrls?: string[]; voiceUrl?: string; voiceDuration?: number; replyToId?: string; file?: unknown }) => {
      try {
        if (!checkRateLimit(userId)) {
          socket.emit('error', { message: 'Too many messages' });
          return;
        }
        const chat = await chatModel.findChatById(data.chatId);
        if (!chat || !chat.participantIds.includes(userId)) {
          socket.emit('error', { message: 'Forbidden' });
          return;
        }
        socket.join(`chat:${data.chatId}`);
        const message = await messageService.createMessage(
          data.chatId,
          userId,
          data.text,
          data.imageUrl,
          data.voiceUrl,
          data.voiceDuration,
          data.replyToId,
          data.imageUrls,
          'text',
          undefined,
          data.file === undefined || data.file === null ? undefined : validateFileRef(data.file)
        );
        for (const pid of chat.participantIds) {
          if (pid === userId) continue;
          const sockets = userSockets.get(pid);
          if (!sockets) continue;
          for (const sid of sockets) {
            const s = io.sockets.sockets.get(sid);
            if (s) {
              s.join(`chat:${data.chatId}`);
              s.emit('chat:new-room', { chatId: data.chatId });
            }
          }
        }
        socket.to(`chat:${data.chatId}`).emit('message:new', message);
        socket.emit('message:new', message);
      } catch (err: unknown) {
        socket.emit('error', { message: err instanceof Error ? err.message : String(err) });
      }
    });

    socket.on('message:edit', async (data: { messageId: string; text: string; chatId: string }) => {
      try {
        if (!checkRateLimit(userId)) {
          socket.emit('error', { message: 'Too many messages' });
          return;
        }
        const chat = await chatModel.findChatById(data.chatId);
        if (!chat || !chat.participantIds.includes(userId)) {
          socket.emit('error', { message: 'Forbidden' });
          return;
        }
        const message = await messageService.editMessage(data.messageId, data.text, userId);
        socket.to(`chat:${data.chatId}`).emit('message:edited', message);
        socket.emit('message:edited', message);
      } catch (err: unknown) {
        socket.emit('error', { message: err instanceof Error ? err.message : String(err) });
      }
    });

    socket.on('message:delete', async (data: { messageId: string; chatId: string }) => {
      try {
        if (!checkRateLimit(userId)) {
          socket.emit('error', { message: 'Too many messages' });
          return;
        }
        const chat = await chatModel.findChatById(data.chatId);
        if (!chat || !chat.participantIds.includes(userId)) {
          socket.emit('error', { message: 'Forbidden' });
          return;
        }
        await messageService.deleteMessage(data.messageId, userId);
        socket.to(`chat:${data.chatId}`).emit('message:deleted', { messageId: data.messageId, chatId: data.chatId });
        socket.emit('message:deleted', { messageId: data.messageId, chatId: data.chatId });
      } catch (err: unknown) {
        socket.emit('error', { message: err instanceof Error ? err.message : String(err) });
      }
    });

    socket.on('message:typing', async (data: { chatId: string }) => {
      const allowed = await ensureChatParticipant(data.chatId, userId);
      if (!allowed) {
        socket.emit('error', { message: 'Forbidden' });
        return;
      }
      socket.to(`chat:${data.chatId}`).emit('typing:start', {
        chatId: data.chatId,
        userId,
        userName,
      });
    });

    // A person answers an agent's question card (button or typed reply).
    // The optional ack tells the client whether the answer was accepted.
    socket.on('question:answer', async (data: { messageId: string; answer: string }, ack?: (r: { ok: boolean; error?: string }) => void) => {
      const reply = typeof ack === 'function' ? ack : () => undefined;
      try {
        if (!checkRateLimit(userId)) {
          reply({ ok: false, error: 'Too many messages' });
          return;
        }
        const updated = await agentService.answerQuestion(userId, data?.messageId, data?.answer);
        await emitToChat(updated.chatId, 'message:updated', updated);
        reply({ ok: true });
      } catch (err: unknown) {
        reply({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    });

    socket.on('handoff:claim', async (data: { messageId: string }, ack?: (r: { ok: boolean; error?: string }) => void) => {
      const reply = typeof ack === 'function' ? ack : () => undefined;
      try {
        if (!checkRateLimit(userId)) {
          reply({ ok: false, error: 'Too many messages' });
          return;
        }
        const updated = await agentService.claimHandoffByPerson(userId, data?.messageId);
        await emitToChat(updated.chatId, 'message:updated', updated);
        reply({ ok: true });
      } catch (err: unknown) {
        reply({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    });

    socket.on('chat:read', async (data: { chatId: string }) => {
      try {
        const allowed = await ensureChatParticipant(data.chatId, userId);
        if (!allowed) {
          socket.emit('error', { message: 'Forbidden' });
          return;
        }
        const messageIds = await messageService.markChatRead(data.chatId, userId);
        if (messageIds.length > 0) {
          socket.to(`chat:${data.chatId}`).emit('message:read', {
            chatId: data.chatId,
            userId,
            messageIds,
          });
        }
      } catch (err: unknown) {
        socket.emit('error', { message: err instanceof Error ? err.message : String(err) });
      }
    });

    socket.on('chat:created', async (data: { chatId: string }) => {
      const chat = await chatModel.findChatById(data.chatId);
      if (!chat) {
        socket.emit('error', { message: 'Chat not found' });
        return;
      }
      if (!chat.participantIds.includes(userId)) {
        socket.emit('error', { message: 'Forbidden' });
        return;
      }
      socket.join(`chat:${data.chatId}`);
      for (const pid of chat.participantIds) {
        if (pid === userId) continue;
        const sockets = userSockets.get(pid);
        if (!sockets) continue;
        for (const sid of sockets) {
          const s = io.sockets.sockets.get(sid);
          if (s) {
            s.join(`chat:${data.chatId}`);
            s.emit('chat:new-room', { chatId: data.chatId });
          }
        }
      }
    });

    socket.on('chat:delete', async (data: { chatId: string }) => {
      try {
        await chatService.deleteChat(data.chatId, userId);
        socket.to(`chat:${data.chatId}`).emit('chat:deleted', { chatId: data.chatId });
        socket.emit('chat:deleted', { chatId: data.chatId });
        socket.leave(`chat:${data.chatId}`);
      } catch (err: unknown) {
        socket.emit('error', { message: err instanceof Error ? err.message : String(err) });
      }
    });

    socket.on('chat:leave', async (data: { chatId: string }) => {
      try {
        if (!data?.chatId) {
          socket.emit('error', { message: 'Chat ID is required' });
          return;
        }
        const allowed = await ensureChatParticipant(data.chatId, userId);
        if (!allowed) {
          socket.emit('error', { message: 'Forbidden' });
          return;
        }
        socket.leave(`chat:${data.chatId}`);
        logger(`Socket ${socket.id} left chat room ${data.chatId}`);
      } catch (err: unknown) {
        socket.emit('error', { message: 'Failed to leave chat' });
      }
    });

    socket.on('disconnect', async () => {
      logger(`Socket disconnected: user ${userId}`);
      const sockets = userSockets.get(userId);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          userSockets.delete(userId);
          try {
            await presenceService.setOffline(userId);
            const lastSeenAt = await UserModel.setLastSeen(userId);
            // Only people who share a chat with this user see their presence.
            emitToUsers(await UserModel.findContactIds(userId), 'presence:update', { userId, status: 'offline', lastSeenAt });
          } catch (err) {
            logger(`Failed to set offline presence for user ${userId}: ${err}`, 'error');
          }
        }
      }
    });

    await initSocketSession(socket, userId);
  });

  return io;
}

async function initSocketSession(socket: Socket, userId: string): Promise<void> {
  let contacts: string[] = [];
  try {
    contacts = await UserModel.findContactIds(userId);
  } catch (err) {
    logger(`Failed to load contacts for ${userId}: ${err}`, 'error');
  }

  try {
    await presenceService.setOnline(userId);
    await UserModel.setLastSeen(userId);
    emitToUsers(contacts, 'presence:update', { userId, status: 'online' });
  } catch (err) {
    logger(`Failed to set online presence for user ${userId}: ${err}`, 'error');
  }

  try {
    if (contacts.length > 0) {
      const online = await presenceService.getOnlineUsers(contacts);
      for (const [id, isOnline] of online) {
        if (isOnline) socket.emit('presence:update', { userId: id, status: 'online' as const });
      }
    }
  } catch (err) {
    logger(`Failed to get online contacts for ${userId}: ${err}`, 'error');
  }

  try {
    const chats = await chatModel.findChatsByUserId(userId);
    for (const chat of chats) {
      socket.join(`chat:${chat.id}`);
    }
  } catch (err) {
    logger(`Failed to load chats for user ${userId}: ${err}`, 'error');
  }
}
