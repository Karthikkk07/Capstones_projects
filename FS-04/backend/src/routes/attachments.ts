import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { env } from '../config/env';
import { scoped } from '../lib/scoped';
import { AppError, badRequest, notFound } from '../lib/errors';
import { ctx, requirePermission } from '../middleware/auth';
import { recordAudit } from '../services/audit';
import { findIssueByIdOrKey } from '../services/issues';

export const ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/json',
  'application/zip',
]);

const uploadDir = (workspaceId: string) => path.resolve(env.UPLOAD_DIR, workspaceId);

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const dir = uploadDir(req.auth!.workspaceId);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    // Never trust the client filename on disk: random name + sanitized extension.
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).replace(/[^.a-zA-Z0-9]/g, '').slice(0, 10).toLowerCase();
      cb(null, crypto.randomUUID() + ext);
    },
  }),
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) return cb(null, true);
    cb(new AppError(415, 'UNSUPPORTED_FILE_TYPE', `File type ${file.mimetype} is not allowed`));
  },
});

// Resolve the issue (tenant-scoped) before multer touches the disk.
async function loadIssue(req: Request, res: Response, next: NextFunction) {
  res.locals.issue = await findIssueByIdOrKey(ctx(req).workspaceId, req.params.id as string);
  next();
}

export const attachmentsRouter = Router();

attachmentsRouter.get('/issues/:id/attachments', requirePermission('issue:read'), async (req, res) => {
  const { workspaceId } = ctx(req);
  const issue = await findIssueByIdOrKey(workspaceId, req.params.id);
  const items = await scoped(workspaceId).attachment.findMany({
    where: { issueId: issue.id },
    orderBy: { createdAt: 'asc' },
    include: { uploader: { select: { id: true, name: true } } },
  });
  res.json({ items });
});

attachmentsRouter.post(
  '/issues/:id/attachments',
  requirePermission('attachment:write'),
  loadIssue,
  upload.single('file'),
  async (req, res) => {
    const auth = ctx(req);
    if (!req.file) throw badRequest('A "file" field is required');
    const attachment = await scoped(auth.workspaceId).attachment.create({
      data: {
        workspaceId: auth.workspaceId,
        issueId: res.locals.issue.id,
        uploaderId: auth.userId,
        filename: req.file.originalname,
        storedName: req.file.filename,
        mimeType: req.file.mimetype,
        size: req.file.size,
      },
    });
    await recordAudit({
      workspaceId: auth.workspaceId,
      actorId: auth.userId,
      action: 'attachment.created',
      entity: 'issue',
      entityId: res.locals.issue.id,
      meta: { after: { attachmentId: attachment.id, filename: attachment.filename, size: attachment.size } },
    });
    res.status(201).json(attachment);
  },
);

attachmentsRouter.get('/attachments/:id/download', requirePermission('issue:read'), async (req, res) => {
  const { workspaceId } = ctx(req);
  const attachment = await scoped(workspaceId).attachment.findFirst({ where: { id: req.params.id } });
  if (!attachment) throw notFound('Attachment');
  const file = path.join(uploadDir(workspaceId), path.basename(attachment.storedName));
  if (!fs.existsSync(file)) throw notFound('Attachment file');
  res.download(file, attachment.filename);
});

attachmentsRouter.delete('/attachments/:id', requirePermission('attachment:write'), async (req, res) => {
  const auth = ctx(req);
  const db = scoped(auth.workspaceId);
  const attachment = await db.attachment.findFirst({ where: { id: req.params.id } });
  if (!attachment) throw notFound('Attachment');
  await db.attachment.deleteMany({ where: { id: attachment.id } });
  await fs.promises.rm(path.join(uploadDir(auth.workspaceId), path.basename(attachment.storedName)), { force: true });
  await recordAudit({
    workspaceId: auth.workspaceId,
    actorId: auth.userId,
    action: 'attachment.deleted',
    entity: 'issue',
    entityId: attachment.issueId,
    meta: { before: { attachmentId: attachment.id, filename: attachment.filename } },
  });
  res.status(204).end();
});
