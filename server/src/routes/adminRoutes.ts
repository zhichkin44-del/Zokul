import { Router, Response, NextFunction } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/authMiddleware';
import * as UserModel from '../models/User';
import * as adminService from '../services/adminService';
import * as inviteService from '../services/inviteService';
import { recentEvents } from '../services/auditService';

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
