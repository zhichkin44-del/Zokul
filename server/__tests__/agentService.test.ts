import * as agentService from '../src/services/agentService';
import * as AgentModel from '../src/models/Agent';
import * as ChatModel from '../src/models/Chat';
import * as MessageModel from '../src/models/Message';
import * as messageService from '../src/services/messageService';
import { emitToChat } from '../src/socket';

jest.mock('../src/models/Agent');
jest.mock('../src/models/Chat');
jest.mock('../src/models/Message');
jest.mock('../src/services/messageService');
jest.mock('../src/socket', () => ({ emitToChat: jest.fn(), joinUserToChat: jest.fn() }));

const agent = { id: 'agent1', name: 'Claude Code', ownerId: 'owner1', createdAt: '' };

describe('agentService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (ChatModel.findExistingChat as jest.Mock).mockResolvedValue({ id: 'chat1' });
    (messageService.createMessage as jest.Mock).mockImplementation(
      async (chatId, senderId, text, _i, _v, _d, _r, _u, kind, payload) => ({ id: 'm1', chatId, senderId, text, kind, payload, createdAt: '' })
    );
  });

  it('stores only a hash of the agent token', async () => {
    (AgentModel.createAgent as jest.Mock).mockResolvedValue(agent);
    (ChatModel.createChat as jest.Mock).mockResolvedValue({ id: 'chat1' });

    const { token } = await agentService.createAgent('owner1', 'Claude Code');

    expect(token).toMatch(/^zk_/);
    const storedHash = (AgentModel.replaceToken as jest.Mock).mock.calls[0][1];
    expect(storedHash).toBe(agentService.hashToken(token));
    expect(storedHash).not.toContain(token);
  });

  it('rejects tokens without the zk_ prefix without touching the database', async () => {
    expect(await agentService.authenticate('eyJhbGciOi.jwt.cookie')).toBeNull();
    expect(AgentModel.findByTokenHash).not.toHaveBeenCalled();
  });

  it('posts a question card to the owner chat and broadcasts it', async () => {
    await agentService.askQuestion(agent, { question: 'Delete old migrations?', options: ['Yes', 'No'] });

    const args = (messageService.createMessage as jest.Mock).mock.calls[0];
    expect(args[0]).toBe('chat1');
    expect(args[8]).toBe('question');
    expect(args[9]).toEqual({ question: 'Delete old migrations?', options: ['Yes', 'No'], answer: null });
    expect(emitToChat).toHaveBeenCalledWith('chat1', 'message:new', expect.objectContaining({ id: 'm1' }));
  });

  it('validates agent input', async () => {
    await expect(agentService.postStatus(agent, { state: 'exploded', text: 'x' })).rejects.toThrow(agentService.AgentInputError);
    await expect(agentService.askQuestion(agent, { question: '   ' })).rejects.toThrow('question is required');
    await expect(agentService.askQuestion(agent, { question: 'q', options: Array(7).fill('o') })).rejects.toThrow(agentService.AgentInputError);
    await expect(agentService.createHandoff(agent, { title: 'T', next: 'not a list' })).rejects.toThrow('next must be an array');
  });

  describe('answerQuestion', () => {
    const question = { id: 'q1', chatId: 'chat1', senderId: 'agent1', kind: 'question', payload: { question: 'q', options: [], answer: null } };

    it('lets a chat participant answer once', async () => {
      (MessageModel.findById as jest.Mock).mockResolvedValue(question);
      (MessageModel.isParticipant as jest.Mock).mockResolvedValue(true);
      (MessageModel.updatePayload as jest.Mock).mockResolvedValue({ ...question, payload: { answer: 'Yes' } });

      await agentService.answerQuestion('owner1', 'q1', 'Yes');

      const [, payload, guard] = (MessageModel.updatePayload as jest.Mock).mock.calls[0];
      expect(payload).toMatchObject({ answer: 'Yes', answeredBy: 'owner1' });
      expect(guard).toEqual({ keys: ['answer', 'cancelled'] });
    });

    it('refuses people outside the chat', async () => {
      (MessageModel.findById as jest.Mock).mockResolvedValue(question);
      (MessageModel.isParticipant as jest.Mock).mockResolvedValue(false);

      await expect(agentService.answerQuestion('stranger', 'q1', 'Yes')).rejects.toThrow('Forbidden');
      expect(MessageModel.updatePayload).not.toHaveBeenCalled();
    });

    it('reports a question that was already answered', async () => {
      (MessageModel.findById as jest.Mock).mockResolvedValue(question);
      (MessageModel.isParticipant as jest.Mock).mockResolvedValue(true);
      (MessageModel.updatePayload as jest.Mock).mockResolvedValue(null);

      await expect(agentService.answerQuestion('owner1', 'q1', 'No')).rejects.toThrow('already answered or was withdrawn');
    });
  });

  it('returns the answer to the agent that asked', async () => {
    (MessageModel.findById as jest.Mock).mockResolvedValue({
      id: 'q1', senderId: 'agent1', kind: 'question', payload: { answer: 'Yes', answeredBy: 'owner1' },
    });
    expect(await agentService.getAnswer(agent, 'q1')).toMatchObject({ status: 'answered', answer: 'Yes' });

    // another agent cannot read it
    expect(await agentService.getAnswer({ ...agent, id: 'agent2' }, 'q1')).toBeNull();
  });

  it('lets the asking agent withdraw its question, and reports it as cancelled', async () => {
    const q = { id: 'q1', chatId: 'chat1', senderId: 'agent1', kind: 'question', payload: { question: 'q', options: [], answer: null } };
    (MessageModel.findById as jest.Mock).mockResolvedValue(q);
    (MessageModel.updatePayload as jest.Mock).mockResolvedValue({ ...q, payload: { ...q.payload, cancelled: true } });

    expect(await agentService.cancelQuestion(agent, 'q1')).toEqual({ ok: true });
    expect((MessageModel.updatePayload as jest.Mock).mock.calls[0][2]).toEqual({ keys: ['answer', 'cancelled'] });
    expect(emitToChat).toHaveBeenCalledWith('chat1', 'message:updated', expect.anything());

    (MessageModel.findById as jest.Mock).mockResolvedValue({ ...q, payload: { ...q.payload, cancelled: true } });
    expect(await agentService.getAnswer(agent, 'q1')).toEqual({ status: 'cancelled' });

    // another agent cannot withdraw it
    expect(await agentService.cancelQuestion({ ...agent, id: 'agent2' }, 'q1')).toEqual({ error: 'not_found' });
  });

  it('does not let an agent claim a handoff of another owner', async () => {
    (MessageModel.findById as jest.Mock).mockResolvedValue({ id: 'h1', kind: 'handoff', payload: {} });
    (AgentModel.listHandoffs as jest.Mock).mockResolvedValue([]);

    expect(await agentService.claimHandoff(agent, 'h1')).toEqual({ error: 'not_found' });
    expect(MessageModel.updatePayload).not.toHaveBeenCalled();
  });
});
