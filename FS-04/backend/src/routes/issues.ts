import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { scoped } from '../lib/scoped';
import { parse } from '../lib/validate';
import { badRequest } from '../lib/errors';
import { ctx, requirePermission } from '../middleware/auth';
import { recordAudit } from '../services/audit';
import { emitEvent } from '../services/events';
import {
  assertSprintOpen,
  assertWorkspaceMember,
  createIssue,
  findIssueByIdOrKey,
  issueInclude,
  moveIssue,
  notifyAssignee,
} from '../services/issues';

const type = z.enum(['TASK', 'BUG', 'STORY', 'EPIC']);
const priority = z.enum(['LOWEST', 'LOW', 'MEDIUM', 'HIGH', 'HIGHEST']);

const createSchema = z.object({
  projectId: z.string().min(1),
  boardId: z.string().min(1).optional(),
  statusId: z.string().min(1).optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(20000).nullish(),
  type: type.optional(),
  priority: priority.optional(),
  assigneeId: z.string().min(1).nullish(),
  sprintId: z.string().min(1).nullish(),
  storyPoints: z.number().int().min(0).max(1000).nullish(),
});

const updateSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(20000).nullable(),
    type,
    priority,
    assigneeId: z.string().min(1).nullable(),
    storyPoints: z.number().int().min(0).max(1000).nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'At least one field is required');

const moveSchema = z.object({
  toColumnId: z.string().min(1),
  position: z.number().int().min(0).optional(),
});

const sprintSchema = z.object({ sprintId: z.string().min(1).nullable() });

const listSchema = z.object({
  projectId: z.string().optional(),
  boardId: z.string().optional(),
  statusId: z.string().optional(),
  assigneeId: z.string().optional(), // user id, or "me" / "none"
  sprintId: z.string().optional(), // sprint id, or "none" for the backlog
  type: type.optional(),
  priority: priority.optional(),
  q: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  offset: z.coerce.number().int().min(0).default(0),
});

export const issuesRouter = Router();

issuesRouter.get('/issues', requirePermission('issue:read'), async (req, res) => {
  const { workspaceId, userId } = ctx(req);
  const f = parse(listSchema, req.query);
  const where: Prisma.IssueWhereInput = {
    ...(f.projectId && { projectId: f.projectId }),
    ...(f.boardId && { boardId: f.boardId }),
    ...(f.statusId && { statusId: f.statusId }),
    ...(f.type && { type: f.type }),
    ...(f.priority && { priority: f.priority }),
    ...(f.assigneeId && { assigneeId: f.assigneeId === 'me' ? userId : f.assigneeId === 'none' ? null : f.assigneeId }),
    ...(f.sprintId && { sprintId: f.sprintId === 'none' ? null : f.sprintId }),
    ...(f.q && {
      OR: [
        { title: { contains: f.q, mode: 'insensitive' as const } },
        { key: { contains: f.q, mode: 'insensitive' as const } },
      ],
    }),
  };
  const db = scoped(workspaceId);
  const [items, total] = await Promise.all([
    db.issue.findMany({
      where,
      include: issueInclude,
      orderBy: [{ statusId: 'asc' }, { position: 'asc' }],
      take: f.limit,
      skip: f.offset,
    }),
    db.issue.count({ where }),
  ]);
  res.json({ items, total });
});

issuesRouter.post('/issues', requirePermission('issue:write'), async (req, res) => {
  const issue = await createIssue(ctx(req), parse(createSchema, req.body));
  res.status(201).json(issue);
});

issuesRouter.get('/issues/:id', requirePermission('issue:read'), async (req, res) => {
  res.json(await findIssueByIdOrKey(ctx(req).workspaceId, req.params.id));
});

issuesRouter.patch('/issues/:id', requirePermission('issue:write'), async (req, res) => {
  const auth = ctx(req);
  const patch = parse(updateSchema, req.body);
  const before = await findIssueByIdOrKey(auth.workspaceId, req.params.id);
  if (patch.assigneeId) await assertWorkspaceMember(auth.workspaceId, patch.assigneeId);

  await scoped(auth.workspaceId).issue.updateMany({ where: { id: before.id }, data: patch });
  const after = await findIssueByIdOrKey(auth.workspaceId, before.id);

  const changed = Object.keys(patch) as (keyof typeof patch)[];
  await recordAudit({
    workspaceId: auth.workspaceId,
    actorId: auth.userId,
    action: 'issue.updated',
    entity: 'issue',
    entityId: before.id,
    meta: {
      before: Object.fromEntries(changed.map((k) => [k, before[k as keyof typeof before]])),
      after: Object.fromEntries(changed.map((k) => [k, after[k as keyof typeof after]])),
    },
  });
  await emitEvent(auth.workspaceId, 'issue.updated', after);
  if (patch.assigneeId && patch.assigneeId !== before.assigneeId) await notifyAssignee(auth, after, patch.assigneeId);
  res.json(after);
});

issuesRouter.delete('/issues/:id', requirePermission('issue:delete'), async (req, res) => {
  const auth = ctx(req);
  const issue = await findIssueByIdOrKey(auth.workspaceId, req.params.id);
  await scoped(auth.workspaceId).issue.deleteMany({ where: { id: issue.id } });
  await recordAudit({
    workspaceId: auth.workspaceId,
    actorId: auth.userId,
    action: 'issue.deleted',
    entity: 'issue',
    entityId: issue.id,
    meta: { before: { key: issue.key, title: issue.title } },
  });
  await emitEvent(auth.workspaceId, 'issue.deleted', { id: issue.id, key: issue.key });
  res.status(204).end();
});

issuesRouter.post('/issues/:id/move', requirePermission('issue:write'), async (req, res) => {
  const body = parse(moveSchema, req.body);
  res.json(await moveIssue(ctx(req), req.params.id, body.toColumnId, body.position));
});

issuesRouter.put('/issues/:id/sprint', requirePermission('issue:write'), async (req, res) => {
  const auth = ctx(req);
  const { sprintId } = parse(sprintSchema, req.body);
  const issue = await findIssueByIdOrKey(auth.workspaceId, req.params.id);
  if (sprintId) await assertSprintOpen(auth.workspaceId, sprintId, issue.projectId);
  else if (!issue.sprintId) throw badRequest('Issue is not in a sprint');

  await scoped(auth.workspaceId).issue.updateMany({ where: { id: issue.id }, data: { sprintId } });
  const after = await findIssueByIdOrKey(auth.workspaceId, issue.id);
  await recordAudit({
    workspaceId: auth.workspaceId,
    actorId: auth.userId,
    action: 'issue.sprint_changed',
    entity: 'issue',
    entityId: issue.id,
    meta: { before: { sprintId: issue.sprintId }, after: { sprintId } },
  });
  await emitEvent(auth.workspaceId, 'issue.updated', after);
  res.json(after);
});

issuesRouter.get('/issues/:id/activity', requirePermission('issue:read'), async (req, res) => {
  const { workspaceId } = ctx(req);
  const issue = await findIssueByIdOrKey(workspaceId, req.params.id);
  const items = await scoped(workspaceId).auditLog.findMany({
    where: { entity: 'issue', entityId: issue.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { actor: { select: { id: true, name: true } } },
  });
  res.json({ items });
});
