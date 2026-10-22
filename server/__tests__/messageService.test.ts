import * as messageService from '../src/services/messageService';
import * as MessageModel from '../src/models/Message';
import * as ChatModel from '../src/models/Chat';
import * as UserModel from '../src/models/User';
import { sendPushNotification } from '../src/services/notificationService';

jest.mock('../src/models/Message');
jest.mock('../src/models/Chat');
jest.mock('../src/models/User');
jest.mock('../src/services/notificationService', () => ({ sendPushNotification: jest.fn() }));

describe('messageService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should create a text message', async () => {
    const msg = { id: 'm1', chatId: 'c1', senderId: 'u1', text: 'Hello', createdAt: '' };
    (MessageModel.create as jest.Mock).mockResolvedValue(msg);

    const result = await messageService.createMessage('c1', 'u1', 'Hello');
    expect(result.text).toBe('Hello');
  });

  it('should throw on empty message', async () => {
    await expect(messageService.createMessage('c1', 'u1'))
      .rejects.toThrow('Message must have text, image, or voice');
  });

  it('should get messages with pagination', async () => {
    (MessageModel.findByChatId as jest.Mock).mockResolvedValue([]);
    const result = await messageService.getMessages('c1', 0, 50);
    expect(MessageModel.findByChatId).toHaveBeenCalledWith('c1', 0, 50);
    expect(result).toEqual([]);
  });

  it('pushes agent results and questions, but not progress updates', async () => {
    (MessageModel.create as jest.Mock).mockResolvedValue({ id: 'm1', chatId: 'c1', senderId: 'agent', createdAt: '' });
    (ChatModel.findChatById as jest.Mock).mockResolvedValue({ id: 'c1', participantIds: ['agent', 'owner'] });
    (UserModel.findById as jest.Mock).mockResolvedValue({ id: 'agent', name: 'Claude Code' });

    const create = (kind: 'status' | 'question', payload: Record<string, unknown>) =>
      messageService.createMessage('c1', 'agent', 'text', undefined, undefined, undefined, undefined, undefined, kind, payload);

    await create('status', { state: 'working' });
    await create('status', { state: 'info' });
    expect(sendPushNotification).not.toHaveBeenCalled();

    await create('status', { state: 'failed' });
    await create('question', { question: 'q', options: [], answer: null });
    expect(sendPushNotification).toHaveBeenCalledTimes(2);
    expect(sendPushNotification).toHaveBeenCalledWith('owner', 'Claude Code', 'text', expect.objectContaining({ chatId: 'c1' }));
  });
});
