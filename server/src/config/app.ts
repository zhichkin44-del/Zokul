import dotenv from 'dotenv';
dotenv.config();

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    throw new Error(`Missing required environment variable: ${name}.`);
  }
  return val;
}

function optionalEnv(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

// A short or default JWT secret makes every session forgeable.
if (process.env.NODE_ENV === 'production') {
  const secret = process.env.JWT_SECRET || '';
  if (secret.length < 32 || /change-me|local-dev|secret/i.test(secret)) {
    throw new Error('JWT_SECRET must be a random string of at least 32 characters in production.');
  }
}

export const config = {
  port: parseInt(optionalEnv('PORT', '3001'), 10),
  databaseUrl: requireEnv('DATABASE_URL'),
  jwtSecret: requireEnv('JWT_SECRET'),
  uploadDir: optionalEnv('UPLOAD_DIR', './uploads'),
  corsOrigin: optionalEnv('CORS_ORIGIN', 'http://localhost:5173'),
  redisUrl: optionalEnv('REDIS_URL', 'redis://localhost:6379'),
  vapidPublicKey: requireEnv('VAPID_PUBLIC_KEY'),
  vapidPrivateKey: requireEnv('VAPID_PRIVATE_KEY'),
};
