import { pool } from '../src/config/db';
import * as authService from '../src/services/authService';

jest.mock('../src/config/db', () => ({ pool: { connect: jest.fn(), query: jest.fn() } }));
jest.mock('../src/services/auditService', () => ({ logEvent: jest.fn() }));

// A fake transaction: answers each statement by what it starts with.
function fakeClient(opts: { hasPeople: boolean; inviteOk?: boolean; emailTaken?: boolean }) {
  const statements: string[] = [];
  const query = jest.fn(async (sql: string, params?: unknown[]) => {
    statements.push(sql.trim().split(/\s+/).slice(0, 3).join(' '));
    if (sql.includes('FROM users WHERE is_agent')) return { rows: opts.hasPeople ? [{}] : [] };
    if (sql.startsWith('UPDATE invites') || sql.includes('UPDATE invites')) return { rows: opts.inviteOk ? [{ id: 'inv1' }] : [] };
    if (sql.includes('lower(email)')) return { rows: opts.emailTaken ? [{}] : [] };
    if (sql.includes('INSERT INTO users')) {
      return { rows: [{ id: 'u1', email: params![0], name: params![2], created_at: 'now', role: params![3] }] };
    }
    return { rows: [] };
  });
  const client = { query, release: jest.fn() };
  (pool.connect as jest.Mock).mockResolvedValue(client);
  return { client, statements };
}

describe('invite-only registration', () => {
  beforeEach(() => jest.clearAllMocks());

  it('makes the first person on a fresh server its admin, no invite needed', async () => {
    fakeClient({ hasPeople: false });
    const { user } = await authService.register('Owner@Example.com', 'long-enough-pass', 'Owner');
    expect(user.role).toBe('admin');
    expect(user.email).toBe('owner@example.com');
  });

  it('refuses everyone else without a valid invite and rolls back', async () => {
    const { client } = fakeClient({ hasPeople: true, inviteOk: false });
    await expect(authService.register('bob@example.com', 'long-enough-pass', 'Bob', 'inv_wrong')).rejects.toThrow('invalid, used up or expired');
    await expect(authService.register('bob@example.com', 'long-enough-pass', 'Bob')).rejects.toThrow('valid invite is required');
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.query).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO users'), expect.anything());
  });

  it('lets an invited person join as a regular user', async () => {
    fakeClient({ hasPeople: true, inviteOk: true });
    const { user } = await authService.register('bob@example.com', 'long-enough-pass', 'Bob', 'inv_good');
    expect(user.role).toBe('user');
  });

  it('does not use up the invite when the email is taken', async () => {
    const { client } = fakeClient({ hasPeople: true, inviteOk: true, emailTaken: true });
    await expect(authService.register('bob@example.com', 'long-enough-pass', 'Bob', 'inv_good')).rejects.toThrow('Email already registered');
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('validates email and name before touching the database', async () => {
    await expect(authService.register('not-an-email', 'long-enough-pass', 'Bob')).rejects.toThrow('valid email');
    await expect(authService.register('bob@example.com', 'long-enough-pass', '   ')).rejects.toThrow('Name must be');
    expect(pool.connect).not.toHaveBeenCalled();
  });
});
