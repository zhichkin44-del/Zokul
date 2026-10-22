import type { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import * as authService from '../src/services/authService';
import * as UserModel from '../src/models/User';
import { authMiddleware, AuthRequest } from '../src/middleware/authMiddleware';

jest.mock('../src/models/User');

function run(token: string) {
  const req = { cookies: { token }, headers: {} } as unknown as AuthRequest;
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Response;
  const next = jest.fn() as NextFunction;
  return { req, res, next, done: authMiddleware(req, res, next) };
}

describe('security hardening', () => {
  beforeEach(() => jest.clearAllMocks());

  it('refuses passwords longer than bcrypt can check', async () => {
    await expect(authService.register('a@b.co', 'я'.repeat(40), 'A')).rejects.toThrow('Password is too long');
  });

  it('rejects a revoked session (password changed elsewhere)', async () => {
    (UserModel.getTokenVersion as jest.Mock).mockResolvedValue(2);
    const { res, next, done } = run(authService.generateToken('u1', 1));
    await done;
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('fails closed when the revocation check cannot run', async () => {
    (UserModel.getTokenVersion as jest.Mock).mockRejectedValue(new Error('db down'));
    const { res, next, done } = run(authService.generateToken('u1', 0));
    await done;
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('only accepts HS256 tokens signed with our secret', () => {
    const unsigned = jwt.sign({ userId: 'u1', tokenVersion: 0 }, '', { algorithm: 'none' } as jwt.SignOptions);
    expect(() => authService.verifyToken(unsigned)).toThrow();
    const otherSecret = jwt.sign({ userId: 'u1', tokenVersion: 0 }, 'not-our-secret');
    expect(() => authService.verifyToken(otherSecret)).toThrow();
  });
});
