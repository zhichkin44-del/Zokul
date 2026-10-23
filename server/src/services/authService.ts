import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config/app';
import { AuthResponse } from '../types';
import * as UserModel from '../models/User';
import { logger } from '../utils/logger';
import { pool } from '../config/db';
import { consumeInvite, InviteError } from './inviteService';
import { logEvent } from './auditService';

export const SALT_ROUNDS = 10;

const MIN_PASSWORD_LENGTH = 8;
// bcrypt only reads the first 72 bytes; longer input is refused, not silently cut.
const MAX_PASSWORD_BYTES = 72;

export function validatePassword(password: unknown): asserts password is string {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new Error('Password must be at least 8 characters');
  }
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
    throw new Error('Password is too long');
  }
}

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

// Registration is invite-only. The very first person on a fresh server needs
// no invite and becomes its admin.
export async function register(rawEmail: unknown, password: unknown, rawName: unknown, inviteCode?: unknown): Promise<AuthResponse> {
  const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
  const name = typeof rawName === 'string' ? rawName.trim() : '';
  if (!EMAIL.test(email)) throw new InviteError('Enter a valid email');
  if (!name || name.length > 100) throw new InviteError('Name must be 1-100 characters');
  validatePassword(password);
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Serialize registrations so two "first users" cannot both become admin.
    await client.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');
    const people = await client.query('SELECT 1 FROM users WHERE is_agent IS NOT TRUE LIMIT 1');
    const isFirst = people.rows.length === 0;
    const inviteId = isFirst ? null : await consumeInvite(client, inviteCode);
    const existing = await client.query('SELECT 1 FROM users WHERE lower(email) = $1', [email]);
    if (existing.rows.length > 0) throw new Error('Email already registered');
    const result = await client.query(
      `INSERT INTO users (email, password_hash, name, role, invite_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, name, avatar_url, created_at, role`,
      [email, passwordHash, name, isFirst ? 'admin' : 'user', inviteId]
    );
    await client.query('COMMIT');
    const row = result.rows[0];
    const user = { id: row.id, email: row.email, name: row.name, createdAt: row.created_at, role: row.role };
    await logEvent(user.id, 'register', { name, viaInvite: !isFirst });
    logger(`User registered: ${user.id}${isFirst ? ' (first admin)' : ''}`);
    return { token: generateToken(user.id, 0), user };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  const user = typeof email === 'string' ? await UserModel.findByEmail(email.trim()) : null;
  if (!user || user.isAgent) {
    await logEvent(null, 'login_failed', { email: String(email).slice(0, 100) });
    throw new Error('Invalid credentials');
  }
  const valid = await bcrypt.compare(String(password), user.passwordHash);
  if (!valid) {
    await logEvent(user.id, 'login_failed', {});
    throw new Error('Invalid credentials');
  }
  if (user.blocked) {
    await logEvent(user.id, 'login_blocked', {});
    throw new Error('This account is blocked');
  }
  await logEvent(user.id, 'login', {});
  const token = generateToken(user.id, user.tokenVersion);
  logger(`User logged in: ${user.email}`);
  const { passwordHash: _, tokenVersion: __, blocked: ___, ...userWithoutPassword } = user;
  return { token, user: userWithoutPassword };
}

export function generateToken(userId: string, tokenVersion: number = 0): string {
  return jwt.sign({ userId, tokenVersion }, config.jwtSecret, { algorithm: 'HS256', expiresIn: '24h' });
}

export function verifyToken(token: string): { userId: string; tokenVersion: number } {
  return jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] }) as { userId: string; tokenVersion: number };
}

export async function changePassword(userId: string, oldPassword: string, newPassword: string): Promise<void> {
  validatePassword(newPassword);
  const row = await UserModel.findByIdWithPassword(userId);
  if (!row) throw new Error('User not found');
  const valid = await bcrypt.compare(oldPassword, row.passwordHash);
  if (!valid) throw new Error('Current password is incorrect');
  const hash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await UserModel.updatePassword(userId, hash);
  await logEvent(userId, 'password_changed', {});
  logger(`Password changed for user ${userId}`);
}
