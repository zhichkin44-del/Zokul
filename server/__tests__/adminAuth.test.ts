import jwt from 'jsonwebtoken';
import { pool } from '../src/config/db';
import { config } from '../src/config/app';
import * as adminAuth from '../src/services/adminAuthService';
import * as totp from '../src/services/totpService';

jest.mock('../src/config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../src/services/auditService', () => ({ logEvent: jest.fn() }));

const query = pool.query as jest.Mock;
const secret = totp.newSecret();

function owner(over: Partial<Record<string, unknown>> = {}) {
  return {
    email: 'owner@example.com', token_version: 3, totp_secret: totp.encryptSecret(secret), totp_pending: null,
    totp_enabled: true, totp_last_step: null, totp_recovery: [totp.hashRecovery('abcd-efgh')], ...over,
  };
}

// Answers the owner lookup with `row` and every UPDATE with `updated` rows.
function db(row: unknown, updated: unknown[] = []) {
  query.mockImplementation(async (sql: string) => (sql.trim().startsWith('SELECT') ? { rows: row ? [row] : [] } : { rows: updated }));
}

describe('admin unlock cookie', () => {
  beforeEach(() => jest.clearAllMocks());

  it('accepts only a fresh admin token for the same person and session generation', async () => {
    db(owner());
    const good = adminAuth.issueUnlock('u1', 3);
    expect(await adminAuth.checkUnlock(good, 'u1')).toBe(true);
    expect(await adminAuth.checkUnlock(undefined, 'u1')).toBe(false);
    expect(await adminAuth.checkUnlock(good, 'u2')).toBe(false);
    // An ordinary session token is not an admin unlock.
    const session = jwt.sign({ userId: 'u1', tokenVersion: 3 }, config.jwtSecret, { algorithm: 'HS256' });
    expect(await adminAuth.checkUnlock(session, 'u1')).toBe(false);
    // Signed out everywhere (token_version moved on): the unlock dies too.
    expect(await adminAuth.checkUnlock(adminAuth.issueUnlock('u1', 2), 'u1')).toBe(false);
    // Signed with another key.
    const forged = jwt.sign({ userId: 'u1', tokenVersion: 3, purpose: 'admin' }, 'not-the-secret', { algorithm: 'HS256' });
    expect(await adminAuth.checkUnlock(forged, 'u1')).toBe(false);
  });

  it('is useless once two-factor sign-in is reset or the role is gone', async () => {
    const token = adminAuth.issueUnlock('u1', 3);
    db(owner({ totp_enabled: false }));
    expect(await adminAuth.checkUnlock(token, 'u1')).toBe(false);
    db(null); // no longer admin, or blocked
    expect(await adminAuth.checkUnlock(token, 'u1')).toBe(false);
  });
});

describe('admin second factor', () => {
  beforeEach(() => jest.clearAllMocks());

  it('unlocks with a current code only if that time step was not used before', async () => {
    const code = totp.codeAt(secret, totp.currentStep());
    db(owner(), [{}]);
    expect(typeof (await adminAuth.unlock('u1', code))).toBe('string');
    expect(query).toHaveBeenCalledWith(expect.stringContaining('totp_last_step < $2'), ['u1', expect.any(Number)]);
    db(owner(), []); // the guarded UPDATE matched nothing: replay
    await expect(adminAuth.unlock('u1', code)).rejects.toThrow('Wrong code');
  });

  it('accepts a recovery code once, removing it atomically', async () => {
    db(owner(), [{ left: 9 }]);
    await expect(adminAuth.unlock('u1', 'ABCD-EFGH')).resolves.toEqual(expect.any(String));
    expect(query).toHaveBeenCalledWith(expect.stringContaining('array_remove'), ['u1', totp.hashRecovery('abcd-efgh')]);
    db(owner(), []);
    await expect(adminAuth.unlock('u1', 'abcd-efgh')).rejects.toThrow('Wrong code');
  });

  it('rejects junk without touching the replay guard', async () => {
    db(owner(), [{}]);
    for (const junk of ['', '12345', '1234567', 'drop table', null, { code: 1 }]) {
      await expect(adminAuth.unlock('u1', junk)).rejects.toThrow('Wrong code');
    }
    expect(query).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE'), expect.anything());
  });

  it('does not turn 2FA on with a wrong first code', async () => {
    db(owner({ totp_enabled: false, totp_secret: null, totp_pending: totp.encryptSecret(secret) }));
    await expect(adminAuth.enable('u1', '000000')).rejects.toMatchObject({ status: 401 });
    expect(query).not.toHaveBeenCalledWith(expect.stringContaining('totp_enabled = true'), expect.anything());
  });

  it('turns 2FA on with the right code and gives 10 recovery codes once', async () => {
    db(owner({ totp_enabled: false, totp_secret: null, totp_pending: totp.encryptSecret(secret) }));
    const res = await adminAuth.enable('u1', totp.codeAt(secret, totp.currentStep()));
    expect(res.recoveryCodes).toHaveLength(10);
    const stored = query.mock.calls.find(([sql]) => String(sql).includes('totp_enabled = true'))![1][2] as string[];
    expect(stored).not.toContain(res.recoveryCodes[0]); // only hashes are stored
  });

  it('refuses everything for someone who is not the owner', async () => {
    db(null);
    await expect(adminAuth.startSetup('u2')).rejects.toMatchObject({ status: 403 });
    await expect(adminAuth.unlock('u2', '123456')).rejects.toMatchObject({ status: 403 });
  });
});
