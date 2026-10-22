import { Request, Response, NextFunction } from 'express';
import * as agentService from '../services/agentService';

export interface AgentRequest extends Request {
  agent?: agentService.AgentRecord;
}

// Agents authenticate with `Authorization: Bearer zk_...` (never cookies).
export async function agentAuthMiddleware(req: AgentRequest, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) {
    res.status(401).json({ error: 'Agent token required' });
    return;
  }
  try {
    const agent = await agentService.authenticate(token);
    if (!agent) {
      res.status(401).json({ error: 'Invalid agent token' });
      return;
    }
    req.agent = agent;
    next();
  } catch (err) {
    next(err);
  }
}
