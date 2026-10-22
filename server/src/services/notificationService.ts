import { pool } from '../config/db';
import webpush from 'web-push';
import { config } from '../config/app';
import { logger } from '../utils/logger';

webpush.setVapidDetails(
  'mailto:user@example.com',
  config.vapidPublicKey,
  config.vapidPrivateKey
);

export async function saveSubscription(
  userId: string,
  subscription: webpush.PushSubscription
): Promise<void> {
  // An endpoint is one browser on one device. If another account used this
  // device before, drop its row so it stops receiving this user's pushes.
  await pool.query(
    'DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id <> $2',
    [subscription.endpoint, userId]
  );
  await pool.query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
    [userId, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth]
  );
}

export async function removeSubscription(
  userId: string,
  endpoint: string
): Promise<void> {
  await pool.query(
    'DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2',
    [userId, endpoint]
  );
}

export async function getSubscriptions(userId: string): Promise<webpush.PushSubscription[]> {
  const result = await pool.query(
    'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1',
    [userId]
  );
  return result.rows.map((row: { endpoint: string; p256dh: string; auth: string }) => ({
    endpoint: row.endpoint,
    keys: { p256dh: row.p256dh, auth: row.auth },
  }));
}

export async function sendPushNotification(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, string>
): Promise<void> {
  const subscriptions = await getSubscriptions(userId);
  const payload = JSON.stringify({ title, body, data });
  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(sub, payload);
    } catch (err) {
      // Only 404/410 mean the subscription is gone for good; anything else
      // (network blip, push service 5xx) must not silently unsubscribe the user.
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await removeSubscription(userId, sub.endpoint);
      } else {
        logger(`Push to user ${userId} failed (status ${statusCode ?? 'n/a'}): ${err}`, 'warn');
      }
    }
  }
}
