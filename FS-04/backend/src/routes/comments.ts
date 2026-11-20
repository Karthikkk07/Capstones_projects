import { Router } from 'express';
import { z } from 'zod';
import { scoped } from '../lib/scoped';
import { parse } from '../lib/validate';
import { forbidden, notFound } from '../lib/errors';
import { ctx, requirePermission } from '../middleware/auth';
import { hasPermission } from '../permissions';
import { recordAudit } from '../services/audit';
import { emitEvent } from '../services/events';
import { findIssueByIdOrKey } from '../services/issues';
import { queueNotification } from '../services/notify';

const bodySchema = z.object({ body: z.string().trim().min(1).max(10000) });

export const commentsRouter = Router();

commentsRouter.get('/issues/:id/comments', requirePermission('issue:read'), async (req, res) => {
  const { workspaceId } = ctx(req);
  const issue = await findIssueByIdOrKey(workspaceId, req.params.id);
  const items = await scoped(workspaceId).comment.findMany({
    where: { issueId: issue.id },
    orderBy: { createdAt: 'asc' },
    include: { author: { select: { id: true, name: true } } },
  });
  res.json({ items });
});

commentsRouter.post('/issues/:id/comments', requirePermission('comment:write'), async (req, res) => {
  const auth = ctx(req);
  const { body } = parse(bodySchema, req.body);
  const issue = await findIssueByIdOrKey(auth.workspaceId, req.params.id);

  const comment = await scoped(auth.workspaceId).comment.create({
    data: { workspaceId: auth.workspaceId, issueId: issue.id, authorId: auth.userId, body },
    include: { author: { select: { id: true, name: true } } },
  });

  await recordAudit({
    workspaceId: auth.workspaceId,
    actorId: auth.userId,
    action: 'comment.created',
    entity: 'issue',
    entityId: issue.id,
    meta: { after: { commentId: comment.id, body: body.slice(0, 200) } },
  });
  await emitEvent(auth.workspaceId, 'comment.created', { ...comment, issueKey: issue.key });

  const recipients = new Set([issue.assignee?.id, issue.reporter.id].filter((id): id is string => !!id));
  recipients.delete(auth.userId);
  for (const recipientId of recipients) {
    queueNotification({
      type: 'comment.created',
      workspaceId: auth.workspaceId,
      recipientId,
      issueId: issue.id,
      issueKey: issue.key,
      title: issue.title,
      actorName: comment.author?.name,
      excerpt: body.slice(0, 140),
    });
  }
  res.status(201).json(comment);
});

commentsRouter.delete('/comments/:id', requirePermission('comment:write'), async (req, res) => {
  const auth = ctx(req);
  const db = scoped(auth.workspaceId);
  const comment = await db.comment.findFirst({ where: { id: req.params.id } });
  if (!comment) throw notFound('Comment');
  if (comment.authorId !== auth.userId && !hasPermission(auth.role, 'issue:delete')) {
    throw forbidden('Only the author or an admin can delete a comment');
  }
  await db.comment.deleteMany({ where: { id: comment.id } });
  await recordAudit({
    workspaceId: auth.workspaceId,
    actorId: auth.userId,
    action: 'comment.deleted',
    entity: 'issue',
    entityId: comment.issueId,
    meta: { before: { commentId: comment.id } },
  });
  res.status(204).end();
});
