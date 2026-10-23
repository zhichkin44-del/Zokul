import { Router, Response, NextFunction } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/authMiddleware';
import * as UserModel from '../models/User';
import * as adminService from '../services/adminService';
import * as inviteService from '../services/inviteService';
import { logEvent, recentEvents } from '../services/auditService';
import rateLimit from 'express-rate-limit';
import * as adminAuth from '../services/adminAuthService';

// Server administration. Every request re-checks the admin role in the
// database; non-admins get a plain 404 (the panel's existence is not revealed).
const router = Router();
router.use(authMiddleware);
router.use(async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (await UserModel.isAdmin(req.userId!)) return next();
    res.status(404).json({ error: 'Not found' });
  } catch (err) {
    next(err);
  }
});

type Handler = (req: AuthRequest, res: Response) => Promise<void>;
const wrap = (fn: Handler) => (req: AuthRequest, res: Response, next: NextFunction) => fn(req, res).catch(next);

function unlockCookie(req: AuthRequest) {
  return {
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
    maxAge: adminAuth.ADMIN_IDLE_MS,
    path: '/api/admin',
  };
}

// Brute-force guard for the second factor: 6 wrong codes per 15 minutes per
// account (correct codes do not count).
const codeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 6,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => (req as AuthRequest).userId ?? 'anon',
  message: { error: 'Too many code attempts, try again in 15 minutes' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Second factor: these work with the normal session only.
router.get('/2fa/status', wrap(async (req, res) => {
  res.json(await adminAuth.status(req.userId!, req.cookies?.[adminAuth.ADMIN_COOKIE]));
}));
router.post('/2fa/setup', wrap(async (req, res) => { res.json(await adminAuth.startSetup(req.userId!)); }));
router.post('/2fa/enable', codeLimiter, wrap(async (req, res) => {
  const { recoveryCodes, unlock } = await adminAuth.enable(req.userId!, req.body?.code);
  res.cookie(adminAuth.ADMIN_COOKIE, unlock, unlockCookie(req));
  res.json({ recoveryCodes });
}));
router.post('/2fa/unlock', codeLimiter, wrap(async (req, res) => {
  res.cookie(adminAuth.ADMIN_COOKIE, await adminAuth.unlock(req.userId!, req.body?.code), unlockCookie(req));
  res.json({ unlocked: true });
}));
router.post('/lock', wrap(async (req, res) => {
  res.clearCookie(adminAuth.ADMIN_COOKIE, { path: '/api/admin' });
  await logEvent(req.userId!, 'admin_locked', {});
  res.json({ locked: true });
}));

// Everything below needs the unlock cookie; each request renews it, so the
// panel locks itself after 15 minutes without admin activity.
router.use(async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!(await adminAuth.checkUnlock(req.cookies?.[adminAuth.ADMIN_COOKIE], req.userId!))) {
      res.status(401).json({ error: 'Admin panel is locked', locked: true });
      return;
    }
    const version = await UserModel.getTokenVersion(req.userId!);
    res.cookie(adminAuth.ADMIN_COOKIE, adminAuth.issueUnlock(req.userId!, version ?? 0), unlockCookie(req));
    next();
  } catch (err) {
    next(err);
  }
});

router.get('/overview', wrap(async (_req, res) => { res.json(await adminService.overview()); }));
router.get('/health', wrap(async (_req, res) => { res.json(await adminService.health()); }));
router.get('/audit', wrap(async (req, res) => { res.json(await recentEvents(Number(req.query.limit) || 50)); }));

router.get('/invites', wrap(async (_req, res) => { res.json(await inviteService.listInvites()); }));
router.post('/invites', wrap(async (req, res) => { res.status(201).json(await inviteService.createInvite(req.userId!, req.body ?? {})); }));
router.delete('/invites/:id', wrap(async (req, res) => {
  res.status((await inviteService.revokeInvite(req.userId!, req.params.id)) ? 204 : 404).end();
}));

router.get('/users', wrap(async (_req, res) => { res.json(await adminService.listUsers()); }));
router.post('/users/:id/block', wrap(async (req, res) => {
  await adminService.setBlocked(req.userId!, req.params.id, req.body?.blocked === true);
  res.json({ blocked: req.body?.blocked === true });
}));

router.get('/agents', wrap(async (_req, res) => { res.json(await adminService.listAgents()); }));

export default router;
