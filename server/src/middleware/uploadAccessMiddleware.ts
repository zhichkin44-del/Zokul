import { Response, NextFunction } from 'express';
import { pool } from '../config/db';
import { AuthRequest } from './authMiddleware';

// Uploaded media is private: a file is served only to signed-in people who
// are in a chat where it was sent. Avatars are visible to any signed-in user.
export async function uploadAccessMiddleware(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const url = `/uploads${req.path}`;
  try {
    const result = await pool.query(
      `SELECT 1 FROM users WHERE avatar_url = $1
       UNION ALL
       SELECT 1 FROM messages m
       JOIN chat_participants cp ON cp.chat_id = m.chat_id AND cp.user_id = $2
       WHERE m.deleted_at IS NULL
         AND (m.image_url = $1 OR $1 = ANY(m.image_urls) OR m.voice_url = $1 OR m.file_url = $1)
       LIMIT 1`,
      [url, req.userId]
    );
    if (result.rows.length === 0) {
      res.status(404).end();
      return;
    }
    // Personal data: browsers may cache it, shared proxies may not.
    res.setHeader('Cache-Control', 'private, max-age=86400');
    next();
  } catch (err) {
    next(err);
  }
}
