import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import * as UserModel from '../models/User';
import * as presenceService from '../services/presenceService';

export async function search(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const q = (req.query.q as string) || '';
    if (q.length < 2) {
      res.json([]);
      return;
    }
    const users = await UserModel.search(q, req.userId!);
    res.json(users);
  } catch (err) {
    next(err);
  }
}

export async function getOnline(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    // Presence is only visible to people who share a chat.
    const contacts = await UserModel.findContactIds(req.userId!);
    if (!contacts.includes(req.params.id)) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    const online = await presenceService.isOnline(req.params.id);
    res.json({ online });
  } catch (err) {
    next(err);
  }
}

export async function updateProfile(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { name, avatarUrl } = req.body;
    if (name !== undefined && (typeof name !== 'string' || name.trim().length < 1 || name.length > 100)) {
      res.status(400).json({ error: 'Name must be 1-100 characters' });
      return;
    }
    // Only our own uploaded image (or none); an outside URL would be loaded by
    // every contact's browser.
    if (avatarUrl !== undefined && avatarUrl !== null && !/^\/uploads\/[0-9a-f-]{36}\.webp$/.test(String(avatarUrl))) {
      res.status(400).json({ error: 'Invalid avatar' });
      return;
    }
    const user = await UserModel.updateProfile(req.userId!, { name, avatarUrl });
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json(user);
  } catch (err) {
    next(err);
  }
}

export async function getById(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await UserModel.findById(req.params.id);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json(user.id === req.userId ? user : { ...user, email: '' });
  } catch (err) {
    next(err);
  }
}
