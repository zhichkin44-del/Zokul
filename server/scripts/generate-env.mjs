// Prints a fresh production .env (random JWT secret, database password and
// push keys). Run on the server: node scripts/generate-env.mjs > ../.env
// Never commit the output.
import { randomBytes } from 'node:crypto';
import webpush from 'web-push';

const vapid = webpush.generateVAPIDKeys();
const secret = (bytes) => randomBytes(bytes).toString('base64url');

process.stdout.write([
  `JWT_SECRET=${secret(48)}`,
  `POSTGRES_PASSWORD=${secret(32)}`,
  `VAPID_PUBLIC_KEY=${vapid.publicKey}`,
  `VAPID_PRIVATE_KEY=${vapid.privateKey}`,
  '',
].join('\n'));
