process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.JWT_SECRET = 'test-secret';
// Fresh VAPID test key pair per run: no key material lives in the repository.
import { createECDH } from 'crypto';
const vapid = createECDH('prime256v1');
vapid.generateKeys();
process.env.VAPID_PUBLIC_KEY = vapid.getPublicKey().toString('base64url');
process.env.VAPID_PRIVATE_KEY = vapid.getPrivateKey().toString('base64url');
