import * as groupService from '../src/services/groupService';
import * as chatModel from '../src/models/Chat';
import * as UserModel from '../src/models/User';

jest.mock('../src/config/db', () => {
  const mockQuery = jest.fn();
  const mockRelease = jest.fn();
  const mockClient = { query: mockQuery, release: mockRelease };
  return {
    pool: {
      connect: jest.fn().mockResolvedValue(mockClient),
      query: mockQuery,
    },
  };
});

jest.mock('../src/models/Chat');
jest.mock('../src/models/User');
jest.mock('../src/socket', () => ({ emitToChat: jest.fn(), emitToUsers: jest.fn(), joinUserToChat: jest.fn(), removeUserFromChat: jest.fn() }));

describe('groupService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // every invited id is an existing person unless a test says otherwise
    (UserModel.findInvitees as jest.Mock).mockImplementation(async (ids: string[]) =>
      ids.map((id) => ({ id, isAgent: false, ownerId: null })));
  });

  it('should create a group with all participants', async () => {
    const { pool } = require('../src/config/db');
    const mockClient = await pool.connect();
    mockClient.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ id: 'group1', created_at: new Date().toISOString() }] })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    (chatModel.findChatById as jest.Mock).mockResolvedValue({
      id: 'group1',
      name: 'Test Group',
      isGroup: true,
      participantIds: ['creator', 'user2', 'user3'],
      participants: [],
      createdAt: new Date().toISOString(),
    });

    const chat = await groupService.createGroup('creator', 'Test Group', ['user2', 'user3']);
    expect(chat.isGroup).toBe(true);
    expect(chat.name).toBe('Test Group');
    expect(chat.participantIds).toContain('creator');
    expect(chat.participantIds).toContain('user2');
    expect(chat.participantIds).toContain('user3');
  });

  it('should not duplicate creator in participantIds', async () => {
    const { pool } = require('../src/config/db');
    const mockClient = await pool.connect();
    mockClient.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ id: 'group2', created_at: new Date().toISOString() }] })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    (chatModel.findChatById as jest.Mock).mockResolvedValue({
      id: 'group2',
      name: 'Group',
      isGroup: true,
      participantIds: ['creator', 'user2'],
      participants: [],
      createdAt: new Date().toISOString(),
    });

    await groupService.createGroup('creator', 'Group', ['user2', 'creator']);
    const insertCalls = mockClient.query.mock.calls.filter(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('INSERT INTO chat_participants')
    );
    const userIds = insertCalls.map((call: any[]) => call[1][1]);
    const creatorCount = userIds.filter((id: string) => id === 'creator').length;
    expect(creatorCount).toBe(1);
  });

  it('should rollback on query failure', async () => {
    const { pool } = require('../src/config/db');
    const mockClient = await pool.connect();
    mockClient.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ id: 'group3', created_at: new Date().toISOString() }] })
      .mockRejectedValueOnce(new Error('DB error'));

    await expect(groupService.createGroup('creator', 'Group', ['user2'])).rejects.toThrow('DB error');
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mockClient.release).toHaveBeenCalled();
  });

  describe('permissions', () => {
    const group = { id: 'g1', isGroup: true, creatorId: 'creator', participantIds: ['creator', 'member'], participants: [], createdAt: '' };

    beforeEach(() => {
      (chatModel.findChatById as jest.Mock).mockResolvedValue(group);
    });

    it('only the creator adds members', async () => {
      await expect(groupService.addMember('g1', 'member', 'newbie')).rejects.toMatchObject({ status: 403 });
      await expect(groupService.addMember('g1', 'creator', 'newbie')).resolves.toBeUndefined();
    });

    it("nobody can add someone else's agent", async () => {
      (UserModel.findInvitees as jest.Mock).mockResolvedValue([{ id: 'bot', isAgent: true, ownerId: 'stranger' }]);
      await expect(groupService.addMember('g1', 'creator', 'bot')).rejects.toThrow('only add your own agents');
    });

    it('members cannot be added to a one-to-one chat', async () => {
      (chatModel.findChatById as jest.Mock).mockResolvedValue({ ...group, isGroup: false, creatorId: undefined });
      await expect(groupService.addMember('g1', 'creator', 'newbie')).rejects.toThrow('not a group');
    });

    it('members leave on their own, only the creator removes others', async () => {
      await expect(groupService.removeMember('g1', 'member', 'creator')).rejects.toMatchObject({ status: 403 });
      await expect(groupService.removeMember('g1', 'member', 'member')).resolves.toBeUndefined();
      await expect(groupService.removeMember('g1', 'creator', 'creator')).rejects.toThrow('cannot leave');
    });

    it('only the creator renames, with a sane name', async () => {
      await expect(groupService.renameGroup('g1', 'member', 'X')).rejects.toMatchObject({ status: 403 });
      await expect(groupService.renameGroup('g1', 'creator', '   ')).rejects.toThrow('1-100 characters');
      await expect(groupService.renameGroup('g1', 'creator', 'Team')).resolves.toBeUndefined();
      expect(chatModel.renameChat).toHaveBeenCalledWith('g1', 'Team');
    });
  });
});
