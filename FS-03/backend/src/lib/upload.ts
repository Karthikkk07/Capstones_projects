import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { env } from '../config/env';
import { HttpError } from './errors';

export const ALLOWED_VIDEO_MIME = ['video/mp4', 'video/quicktime', 'video/x-matroska', 'video/webm', 'video/x-msvideo'];

export function createVideoUpload(opts: { dir: string; maxMb: number }) {
  const dir = path.resolve(opts.dir, 'sources');
  fs.mkdirSync(dir, { recursive: true });
  return multer({
    storage: multer.diskStorage({
      destination: dir,
      filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '');
        cb(null, `${req.params.id}-${Date.now()}${ext}`);
      },
    }),
    limits: { fileSize: opts.maxMb * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => {
      if (ALLOWED_VIDEO_MIME.includes(file.mimetype)) cb(null, true);
      else cb(new HttpError(415, `Unsupported file type ${file.mimetype}; allowed: ${ALLOWED_VIDEO_MIME.join(', ')}`));
    },
  });
}

let instance: ReturnType<typeof createVideoUpload> | undefined;
export const videoUpload = () => (instance ??= createVideoUpload({ dir: env.UPLOAD_DIR, maxMb: env.MAX_UPLOAD_MB }));
