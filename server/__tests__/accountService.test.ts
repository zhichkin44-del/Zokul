import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { pool } from '../src/config/db';
import * as account from '../src/services/accountService';

jest.mock('../src/config/db', () => ({ pool: { connect: jest.fn(), query: jest.fn() } }));
jest.mock('../src/services/auditService', () => ({ logEvent: jest.fn() }));
jest.mock('../src/socket', () => ({ endSessions: jest.fn() }));

const query = pool.query as jest.Mock;
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

function fakeClient(answer: (sql: string) => unknown[]) {
  const client = { query: jest.fn(async (sql: string) => ({ rows: answer(sql) })), release: jest.fn() };
  (pool.connect as jest.Mock).mockResolvedValue(client);
  return client;
}

describe('password reset links', () => {
  beforeEach(() => jest.clearAllMocks());

  it('stores only the hash of a long random token and replaces older links', async () => {
    query.mockImplementation(async (sql: string) => ({ rows: sql.startsWith('SELECT') ? [{ name: 'Bob' }] : [] }));
    const { token } = await account.issueResetLink('admin', 'bob');
    expect(token).toMatch(/^rst_[A-Za-z0-9_-]{43}$/);
    expect(query).toHaveBeenCalledWith('DELETE FROM password_resets WHERE user_id = $1', ['bob']);
    const insert = query.mock.calls.find(([sql]) => String(sql).startsWith('INSERT'))!;
    expect(insert[1][1]).toBe(sha(token));
    expect(JSON.stringify(insert[1])).not.toContain(token);
  });

  it('is not available for the owner, agents or deleted people', async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(account.issueResetLink('admin', 'owner')).rejects.toMatchObject({ status: 404 });
    expect(query.mock.calls[0][0]).toMatch(/role <> 'admin'.*deleted_at IS NULL/s);
  });

  it('rejects malformed tokens without asking the database', async () => {
    for (const bad of [undefined, '', 'rst_short', 'zk_' + 'a'.repeat(43), { token: 1 }]) {
      await expect(account.checkResetLink(bad)).rejects.toThrow('invalid or expired');
    }
    expect(query).not.toHaveBeenCalled();
  });

  it('uses a link once: the guarded UPDATE decides, and sessions end', async () => {
    const token = 'rst_' + 'a'.repeat(43);
    let client = fakeClient((sql) => (sql.includes('UPDATE password_resets') ? [{ user_id: 'bob' }] : []));
    await account.useResetLink(token, 'brand-new-password');
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('used_at IS NULL AND p.expires_at > NOW()'), [sha(token)]);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('token_version = token_version + 1'), ['bob', expect.any(String)]);
    expect(client.query).toHaveBeenCalledWith('COMMIT');

    client = fakeClient(() => []); // already used or expired
    await expect(account.useResetLink(token, 'brand-new-password')).rejects.toThrow('invalid or expired');
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.query).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE users'), expect.anything());
  });

  it('checks the new password before using up the link', async () => {
    await expect(account.useResetLink('rst_' + 'a'.repeat(43), 'short')).rejects.toThrow('at least 8');
    expect(pool.connect).not.toHaveBeenCalled();
  });
});

describe('account deletion', () => {
  beforeEach(() => jest.clearAllMocks());
  const hash = bcrypt.hashSync('right-password', 4);

  it('needs the password', async () => {
    query.mockResolvedValue({ rows: [{ name: 'Bob', role: 'user', password_hash: hash }] });
    await expect(account.deleteAccount('bob', 'wrong')).rejects.toThrow('Current password is incorrect');
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('is refused for the owner', async () => {
    query.mockResolvedValue({ rows: [{ name: 'Owner', role: 'admin', password_hash: hash }] });
    await expect(account.deleteAccount('owner', 'right-password')).rejects.toMatchObject({ status: 403 });
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('anonymizes the person and disables their agents and keys', async () => {
    query.mockResolvedValue({ rows: [{ name: 'Bob', role: 'user', password_hash: hash }] });
    const client = fakeClient((sql) => (sql.includes('owner_id = $1 AND is_agent') ? [{ id: 'agent1' }] : []));
    await account.deleteAccount('bob', 'right-password');
    const sqls = client.query.mock.calls.map(([sql]) => String(sql));
    expect(sqls.some((s) => s.includes("name = 'Deleted account'") && s.includes("password_hash = '!'") && s.includes('avatar_url = NULL'))).toBe(true);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM agent_tokens'), [['agent1']]);
    expect(client.query).toHaveBeenCalledWith('DELETE FROM push_subscriptions WHERE user_id = $1', ['bob']);
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });
});
