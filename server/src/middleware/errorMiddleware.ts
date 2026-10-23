import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { AgentInputError } from '../services/agentService';
import { FileError } from '../services/fileService';
import { GroupError } from '../services/groupService';
import { InviteError } from '../services/inviteService';
import { AdminError } from '../services/adminService';
import { AdminAuthError } from '../services/adminAuthService';
import { AccountError } from '../services/accountService';

export function errorMiddleware(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  logger(err.message, 'error');
  // Postgres "invalid input syntax" (e.g. a non-UUID id in the URL) is a bad
  // request from the client, not a server failure.
  if ((err as { code?: string }).code === '22P02') {
    res.status(400).json({ error: 'Invalid id' });
    return;
  }
  if (err instanceof GroupError || err instanceof AdminError || err instanceof AdminAuthError || err instanceof AccountError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err.message === 'Current password is incorrect') {
    res.status(400).json({ error: err.message });
    return;
  }
  if (err.message === 'This account is blocked') {
    res.status(403).json({ error: err.message });
    return;
  }
  if (err instanceof AgentInputError || err instanceof FileError || err instanceof InviteError) {
    res.status(400).json({ error: err.message });
    return;
  }
  if (err.message === 'Email already registered') {
    res.status(409).json({ error: err.message });
    return;
  }
  if (err.message === 'Invalid credentials') {
    res.status(401).json({ error: err.message });
    return;
  }
  if (err.message === 'Cannot create chat with yourself' || err.message === 'Message must have text, image, or voice') {
    res.status(400).json({ error: err.message });
    return;
  }
  if (err.message === 'Password must be at least 8 characters' || err.message === 'Password is too long') {
    res.status(400).json({ error: err.message });
    return;
  }
  if (err.message === 'Only image and audio files are allowed') {
    res.status(400).json({ error: err.message });
    return;
  }
  if ((err as any).code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: 'File too large' });
    return;
  }
  res.status(500).json({ error: 'Internal server error' });
}
