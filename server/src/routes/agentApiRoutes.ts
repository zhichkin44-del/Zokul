import { Router, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { agentAuthMiddleware, AgentRequest } from '../middleware/agentAuthMiddleware';
import * as agentService from '../services/agentService';

// API used by AI agents (CLI / MCP server) with a bearer token.
const router = Router();

router.use(rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { error: 'Too many agent requests, slow down' },
  standardHeaders: true,
  legacyHeaders: false,
}));
router.use(agentAuthMiddleware);

type Handler = (req: AgentRequest, res: Response) => Promise<void>;
const wrap = (fn: Handler) => (req: AgentRequest, res: Response, next: NextFunction) => fn(req, res).catch(next);

router.get('/me', wrap(async (req, res) => {
  const agent = req.agent!;
  res.json({ id: agent.id, name: agent.name, chatId: await agentService.chatIdFor(agent) });
}));

router.post('/messages', wrap(async (req, res) => {
  const msg = await agentService.postMessage(req.agent!, req.body ?? {});
  res.status(201).json({ id: msg.id });
}));

router.post('/status', wrap(async (req, res) => {
  const msg = await agentService.postStatus(req.agent!, req.body ?? {});
  res.status(201).json({ id: msg.id });
}));

router.post('/questions', wrap(async (req, res) => {
  const msg = await agentService.askQuestion(req.agent!, req.body ?? {});
  res.status(201).json({ id: msg.id, status: 'pending' });
}));

router.get('/questions/:id', wrap(async (req, res) => {
  const wait = Number(req.query.wait) || 0;
  const result = await agentService.getAnswer(req.agent!, req.params.id, wait);
  if (!result) {
    res.status(404).json({ error: 'Question not found' });
    return;
  }
  res.json(result);
}));

router.post('/handoffs', wrap(async (req, res) => {
  const msg = await agentService.createHandoff(req.agent!, req.body ?? {});
  res.status(201).json({ id: msg.id });
}));

router.get('/handoffs', wrap(async (req, res) => {
  const onlyOpen = req.query.status !== 'all';
  res.json(await agentService.listHandoffs(req.agent!, onlyOpen, Number(req.query.limit) || 20));
}));

router.post('/handoffs/:id/claim', wrap(async (req, res) => {
  const result = await agentService.claimHandoff(req.agent!, req.params.id);
  if ('error' in result) {
    if (result.error === 'not_found') res.status(404).json({ error: 'Handoff not found' });
    else res.status(409).json({ error: result.message });
    return;
  }
  res.json(result.handoff);
}));

export default router;
