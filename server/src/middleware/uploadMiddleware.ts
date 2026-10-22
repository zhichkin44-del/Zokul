import { randomUUID } from 'crypto';
import multer from 'multer';
import type { Request } from 'express';
import { config } from '../config/app';

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, config.uploadDir);
  },
  // The extension comes from the checked MIME type, never from the
  // user-supplied file name (an "audio" upload named x.html must not be
  // stored and served as HTML).
  filename: (_req, file, cb) => {
    cb(null, randomUUID() + extensionFor(file.mimetype));
  },
});

const imageMimes = /^image\/(jpeg|png|gif|webp|heic|heif|heic-sequence|heif-sequence)(;.+)?$/;

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp',
  'image/heic': '.heic', 'image/heif': '.heif', 'image/heic-sequence': '.heic', 'image/heif-sequence': '.heif',
  'audio/webm': '.webm', 'audio/ogg': '.ogg', 'audio/wav': '.wav', 'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a', 'audio/x-m4a': '.m4a', 'audio/aac': '.aac',
};

function extensionFor(mimetype: string): string {
  return EXTENSIONS[mimetype.split(';')[0].trim().toLowerCase()] ?? '.bin';
}
const audioMimes = /^audio\/(webm|ogg|wav|mpeg|mp4|x-m4a|aac)(;.+)?$/;

const fileFilter = (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  if (imageMimes.test(file.mimetype) || audioMimes.test(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only image and audio files are allowed'));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 20 * 1024 * 1024 },
});

export const uploadMiddleware = upload.single('file');
