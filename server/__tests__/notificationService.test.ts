import webpush from 'web-push';
import { pool } from '../src/config/db';
import * as notificationService from '../src/services/notificationService';

jest.mock('../src/config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('web-push', () => ({
  __esModule: true,
  default: { setVapidDetails: jest.fn(), sendNotification: jest.fn() },
}));

const query = pool.query as jest.Mock;
const send = webpush.sendNotification as jest.Mock;

const row = { endpoint: 'https://push.example/abc', p256dh: 'p', auth: 'a' };

function deleteCalls() {
  return query.mock.calls.filter(([sql]) => String(sql).startsWith('DELETE FROM push_subscriptions'));
}

describe('notificationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('moves an endpoint away from the previous account on this device', async () => {
    query.mockResolvedValue({ rows: [] });

    await notificationService.saveSubscription('user2', {
      endpoint: row.endpoint,
      keys: { p256dh: 'p', auth: 'a' },
    });

    expect(query.mock.calls[0][0]).toContain('user_id <> $2');
    expect(query.mock.calls[0][1]).toEqual([row.endpoint, 'user2']);
    expect(query.mock.calls[1][0]).toContain('DO UPDATE');
  });

  it('removes a subscription when the push service says it is gone (410)', async () => {
    query.mockResolvedValueOnce({ rows: [row] }).mockResolvedValue({ rows: [] });
    send.mockRejectedValue(Object.assign(new Error('Gone'), { statusCode: 410 }));

    await notificationService.sendPushNotification('user1', 'Title', 'Body');

    expect(deleteCalls()).toHaveLength(1);
  });

  it('keeps the subscription on a temporary push service error (500)', async () => {
    query.mockResolvedValueOnce({ rows: [row] }).mockResolvedValue({ rows: [] });
    send.mockRejectedValue(Object.assign(new Error('Server error'), { statusCode: 500 }));

    await notificationService.sendPushNotification('user1', 'Title', 'Body');

    expect(deleteCalls()).toHaveLength(0);
  });
});
