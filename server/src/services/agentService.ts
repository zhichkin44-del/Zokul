import { createHash, randomBytes } from 'crypto';
import * as AgentModel from '../models/Agent';
import * as ChatModel from '../models/Chat';
import * as MessageModel from '../models/Message';
import * as messageService from './messageService';
import { emitToChat, joinUserToChat } from '../socket';
import { Message } from '../types';
import { logger } from '../utils/logger';

export type AgentRecord = AgentModel.AgentRecord;

export const STATUS_STATES = ['working', 'done', 'failed', 'info'] as const;
export type StatusState = typeof STATUS_STATES[number];

const LIMITS = { name: 60, text: 2000, question: 1000, option: 60, options: 6, listItem: 300, listItems: 30, notes: 4000 };

export class AgentInputError extends Error {}

function clean(value: unknown, max: number, field: string, required = false): string | undefined {
  if (value === undefined || value === null || value === '') {
    if (required) throw new AgentInputError(`${field} is required`);
    return undefined;
  }
  if (typeof value !== 'string') throw new AgentInputError(`${field} must be a string`);
  const trimmed = value.trim();
  if (required && !trimmed) throw new AgentInputError(`${field} is required`);
  if (trimmed.length > max) throw new AgentInputError(`${field} is longer than ${max} characters`);
  return trimmed || undefined;
}

function cleanList(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new AgentInputError(`${field} must be an array of strings`);
  if (value.length > LIMITS.listItems) throw new AgentInputError(`${field} has more than ${LIMITS.listItems} items`);
  return value.map((v, i) => clean(v, LIMITS.listItem, `${field}[${i}]`, true)!);
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function newToken(): string {
  return `zk_${randomBytes(24).toString('base64url')}`;
}

// --- Owner side --------------------------------------------------------------

export async function createAgent(ownerId: string, rawName: unknown) {
  const name = clean(rawName, LIMITS.name, 'name', true)!;
  const agent = await AgentModel.createAgent(ownerId, name);
  const chat = await ChatModel.createChat(ownerId, agent.id);
  joinUserToChat(ownerId, chat.id);
  const token = await issueToken(agent.id);
  logger(`Agent ${agent.id} created by ${ownerId}`);
  return { agent, chatId: chat.id, token };
}

export async function issueToken(agentId: string): Promise<string> {
  const token = newToken();
  await AgentModel.replaceToken(agentId, hashToken(token));
  return token;
}

export async function rotateToken(ownerId: string, agentId: string): Promise<string | null> {
  const agent = await AgentModel.findOwned(agentId, ownerId);
  if (!agent) return null;
  return issueToken(agent.id);
}

export async function listAgents(ownerId: string) {
  const agents = await AgentModel.listByOwner(ownerId);
  return Promise.all(agents.map(async (a) => ({ ...a, chatId: (await ChatModel.findExistingChat(ownerId, a.id))?.id })));
}

// Removes the agent together with its chat, so no empty conversation is left.
export async function deleteAgent(ownerId: string, agentId: string): Promise<boolean> {
  const agent = await AgentModel.findOwned(agentId, ownerId);
  if (!agent) return false;
  const chat = await ChatModel.findExistingChat(ownerId, agentId);
  if (chat) await ChatModel.removeChat(chat.id);
  return AgentModel.deleteAgent(agentId, ownerId);
}

// --- Agent side --------------------------------------------------------------

export async function authenticate(token: string): Promise<AgentRecord | null> {
  if (!token.startsWith('zk_')) return null;
  return AgentModel.findByTokenHash(hashToken(token));
}

// Every agent talks to its owner in one direct chat, created with the agent.
export async function chatIdFor(agent: AgentRecord): Promise<string> {
  const existing = await ChatModel.findExistingChat(agent.ownerId, agent.id);
  if (existing) return existing.id;
  return (await ChatModel.createChat(agent.ownerId, agent.id)).id;
}

// Where an agent posts: its chat with the owner by default, or a project
// room it was added to. It can never post into a chat it is not part of.
async function targetChat(agent: AgentRecord, chatId: unknown): Promise<string> {
  if (chatId === undefined || chatId === null || chatId === '') return chatIdFor(agent);
  if (typeof chatId !== 'string' || !/^[0-9a-f-]{36}$/i.test(chatId) || !(await MessageModel.isParticipant(chatId, agent.id))) {
    throw new AgentInputError('This agent is not a member of that chat');
  }
  return chatId;
}

export async function listChats(agent: AgentRecord) {
  const chats = await ChatModel.findChatsByUserId(agent.id);
  return chats.map((c) => ({
    id: c.id,
    name: c.isGroup ? c.name || 'Group' : 'Direct chat with your owner',
    isGroup: c.isGroup || false,
    members: c.participants.map((p) => ({ name: p.name, isAgent: p.isAgent || false })),
  }));
}

async function post(agent: AgentRecord, text: string, kind: Message['kind'], payload?: Record<string, unknown>, chatId?: unknown): Promise<Message> {
  chatId = await targetChat(agent, chatId);
  // `text` is the plain-language summary used for the chat list, search and push.
  const message = await messageService.createMessage(chatId as string, agent.id, text, undefined, undefined, undefined, undefined, undefined, kind, payload);
  await emitToChat(chatId as string, 'message:new', message);
  return message;
}

export async function postMessage(agent: AgentRecord, raw: { text?: unknown; chatId?: unknown }) {
  return post(agent, clean(raw.text, LIMITS.text, 'text', true)!, 'text', undefined, raw.chatId);
}

export async function postStatus(agent: AgentRecord, raw: { state?: unknown; text?: unknown; chatId?: unknown }) {
  const state = (raw.state ?? 'info') as StatusState;
  if (!STATUS_STATES.includes(state)) throw new AgentInputError(`state must be one of ${STATUS_STATES.join(', ')}`);
  const text = clean(raw.text, LIMITS.text, 'text', true)!;
  return post(agent, text, 'status', { state }, raw.chatId);
}

export async function askQuestion(agent: AgentRecord, raw: { question?: unknown; options?: unknown; chatId?: unknown }) {
  const question = clean(raw.question, LIMITS.question, 'question', true)!;
  const options = raw.options === undefined ? [] : raw.options;
  if (!Array.isArray(options) || options.length > LIMITS.options) {
    throw new AgentInputError(`options must be an array of up to ${LIMITS.options} strings`);
  }
  const cleanOptions = options.map((o, i) => clean(o, LIMITS.option, `options[${i}]`, true)!);
  return post(agent, question, 'question', { question, options: cleanOptions, answer: null }, raw.chatId);
}

async function findOwnCard(agent: AgentRecord, messageId: string, kind: Message['kind']): Promise<Message | null> {
  const msg = await MessageModel.findById(messageId);
  if (!msg || msg.kind !== kind || msg.senderId !== agent.id) return null;
  return msg;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Long-poll: waits up to `waitSeconds` for a human answer so agents do not
// have to hammer the API, but never holds a request longer than 50 s.
export async function getAnswer(agent: AgentRecord, messageId: string, waitSeconds = 0) {
  const deadline = Date.now() + Math.min(Math.max(waitSeconds, 0), 50) * 1000;
  for (;;) {
    const msg = await findOwnCard(agent, messageId, 'question');
    if (!msg) return null;
    const p = msg.payload as { answer?: string | null; answeredBy?: string; answeredAt?: string; cancelled?: boolean };
    if (p.answer) return { status: 'answered' as const, answer: p.answer, answeredBy: p.answeredBy, answeredAt: p.answeredAt };
    if (p.cancelled) return { status: 'cancelled' as const };
    if (Date.now() >= deadline) return { status: 'pending' as const };
    await sleep(1500);
  }
}

// The agent no longer needs the answer: the card stops asking on the phone.
export async function cancelQuestion(agent: AgentRecord, messageId: string) {
  const msg = await findOwnCard(agent, messageId, 'question');
  if (!msg) return { error: 'not_found' as const };
  const updated = await MessageModel.updatePayload(
    messageId,
    { ...msg.payload, cancelled: true, cancelledAt: new Date().toISOString() },
    { keys: ['answer', 'cancelled'] }
  );
  if (!updated) return { error: 'closed' as const };
  await emitToChat(updated.chatId, 'message:updated', updated);
  return { ok: true as const };
}

export async function createHandoff(agent: AgentRecord, raw: Record<string, unknown>) {
  const title = clean(raw.title, 120, 'title', true)!;
  const payload = {
    title,
    summary: clean(raw.summary, LIMITS.text, 'summary'),
    done: cleanList(raw.done, 'done'),
    next: cleanList(raw.next, 'next'),
    files: cleanList(raw.files, 'files'),
    notes: clean(raw.notes, LIMITS.notes, 'notes'),
    claimedBy: null,
  };
  return post(agent, `Handoff: ${title}`, 'handoff', payload, raw.chatId);
}

export async function listHandoffs(agent: AgentRecord, onlyOpen: boolean, limit = 20) {
  const rows = await AgentModel.listHandoffs(agent.ownerId, onlyOpen, Math.min(Math.max(limit, 1), 50));
  return rows.map((r) => ({ id: r.id, from: r.sender_name, createdAt: r.created_at, ...r.payload }));
}

export async function claimHandoff(agent: AgentRecord, messageId: string) {
  const msg = await MessageModel.findById(messageId);
  if (!msg || msg.kind !== 'handoff') return { error: 'not_found' as const };
  const handoffs = await AgentModel.listHandoffs(agent.ownerId, false, 200);
  const row = handoffs.find((h) => h.id === messageId);
  if (!row) return { error: 'not_found' as const };
  const updated = await MessageModel.updatePayload(
    messageId,
    { ...msg.payload, claimedBy: agent.name, claimedById: agent.id, claimedAt: new Date().toISOString() },
    { keys: ['claimedBy'] }
  );
  if (!updated) {
    const takenBy = (msg.payload as { claimedBy?: string } | undefined)?.claimedBy;
    return { error: 'already_claimed' as const, message: `Handoff already taken${takenBy ? ` by ${takenBy}` : ''}` };
  }
  await emitToChat(updated.chatId, 'message:updated', updated);
  return { handoff: { id: updated.id, from: row.sender_name, ...updated.payload } };
}

// --- Human answers a question card (socket) ------------------------------------

export async function answerQuestion(userId: string, messageId: string, rawAnswer: unknown): Promise<Message> {
  const answer = clean(rawAnswer, LIMITS.text, 'answer', true)!;
  const msg = await MessageModel.findById(messageId);
  if (!msg || msg.kind !== 'question') throw new AgentInputError('Question not found');
  if (!(await MessageModel.isParticipant(msg.chatId, userId)) || msg.senderId === userId) {
    throw new AgentInputError('Forbidden');
  }
  const updated = await MessageModel.updatePayload(
    messageId,
    { ...msg.payload, answer, answeredBy: userId, answeredAt: new Date().toISOString() },
    { keys: ['answer', 'cancelled'] }
  );
  if (!updated) throw new AgentInputError('This question is already answered or was withdrawn');
  return updated;
}
