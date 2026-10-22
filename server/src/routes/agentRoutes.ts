import { Router, Response, NextFunction } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/authMiddleware';
import * as agentService from '../services/agentService';

// Managing your agents from the app (cookie session).
const router = Router();
router.use(authMiddleware);

router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await agentService.listAgents(req.userId!));
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await agentService.createAgent(req.userId!, req.body?.name);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/token', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const token = await agentService.rotateToken(req.userId!, req.params.id);
    if (!token) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }
    res.json({ token });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const deleted = await agentService.deleteAgent(req.userId!, req.params.id);
    res.status(deleted ? 204 : 404).end();
  } catch (err) {
    next(err);
  }
});

export default router;
