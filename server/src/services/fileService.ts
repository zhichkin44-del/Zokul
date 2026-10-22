import { randomUUID } from 'crypto';
import { mkdirSync } from 'fs';
import path from 'path';
import multer from 'multer';
import type { Request } from 'express';
import { config } from '../config/app';
import { FileAttachment } from '../types';

// Documents people and agents share (reports, logs, specs). The server picks
// the content type from this list; the browser-sent MIME type is ignored.
const ALLOWED: Record<string, string> = {
  pdf: 'application/pdf',
  txt: 'text/plain',
  log: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  zip: 'application/zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

export const MAX_FILE_SIZE = 20 * 1024 * 1024;
export const FILES_DIR = path.join(config.uploadDir, 'files');
const FILE_URL = /^\/uploads\/files\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.([a-z0-9]+)$/;

export class FileError extends Error {}

function extensionOf(name: string): string {
  return path.extname(name).slice(1).toLowerCase();
}

// Display name only: no paths, control characters or bidi tricks.
export function cleanFileName(name: unknown): string {
  const base = typeof name === 'string' ? name.split(/[\\/]/).pop() || '' : '';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, '').trim().slice(0, 200);
  return cleaned || 'file';
}

mkdirSync(FILES_DIR, { recursive: true });

export const fileUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, FILES_DIR),
    filename: (_req, file, cb) => cb(null, `${randomUUID()}.${extensionOf(file.originalname)}`),
  }),
  fileFilter: (_req: Request, file, cb) => {
    if (ALLOWED[extensionOf(file.originalname)]) cb(null, true);
    else cb(new FileError(`This file type is not allowed. Allowed: ${Object.keys(ALLOWED).join(', ')}`));
  },
  limits: { fileSize: MAX_FILE_SIZE, files: 1 },
}).single('file');

export function describeUpload(file: Express.Multer.File): FileAttachment {
  const ext = extensionOf(file.filename);
  return { url: `/uploads/files/${file.filename}`, name: cleanFileName(file.originalname), size: file.size, mime: ALLOWED[ext] };
}

// A file reference sent with a message must point at our own upload folder
// with an allowed extension; name and type are re-derived on the server.
export function validateFileRef(raw: unknown): FileAttachment {
  const ref = raw as Partial<FileAttachment> | null;
  const match = typeof ref?.url === 'string' ? FILE_URL.exec(ref.url) : null;
  if (!match || !ALLOWED[match[1]]) throw new FileError('Invalid file');
  const size = Number(ref?.size);
  if (!Number.isInteger(size) || size < 0 || size > MAX_FILE_SIZE) throw new FileError('Invalid file size');
  return { url: ref!.url!, name: cleanFileName(ref?.name), size, mime: ALLOWED[match[1]] };
}
