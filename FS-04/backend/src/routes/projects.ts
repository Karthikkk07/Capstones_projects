import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { scoped } from '../lib/scoped';
import { parse } from '../lib/validate';
import { conflict, notFound } from '../lib/errors';
import { ctx, requirePermission } from '../middleware/auth';
import { recordAudit } from '../services/audit';
import { assertWithinLimit } from '../services/planLimits';
import { createDefaultBoard } from '../services/boards';

const createSchema = z.object({
  key: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9]{1,9}$/, 'Key must be 2-10 letters/digits and start with a letter'),
  name: z.string().trim().min(1).max(100),
  description: z.string().max(2000).nullish(),
});
const updateSchema = z
  .object({ name: z.string().trim().min(1).max(100), description: z.string().max(2000).nullable() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'At least one field is required');

export const projectsRouter = Router();

projectsRouter.get('/projects', requirePermission('project:read'), async (req, res) => {
  const { workspaceId } = ctx(req);
  const items = await scoped(workspaceId).project.findMany({
    orderBy: { createdAt: 'asc' },
    include: { _count: { select: { issues: true } } },
  });
  res.json({ items });
});

projectsRouter.post('/projects', requirePermission('project:write'), async (req, res) => {
  const auth = ctx(req);
  const body = parse(createSchema, req.body);
  await assertWithinLimit(auth.workspaceId, 'projects');

  const db = scoped(auth.workspaceId);
  if (await db.project.findFirst({ where: { key: body.key } })) {
    throw conflict(`A project with key ${body.key} already exists`, 'PROJECT_KEY_TAKEN');
  }
  const project = await prisma.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: { workspaceId: auth.workspaceId, key: body.key, name: body.name, description: body.description ?? null },
    });
    await createDefaultBoard(tx, auth.workspaceId, project.id);
    return project;
  });
  await recordAudit({
    workspaceId: auth.workspaceId,
    actorId: auth.userId,
    action: 'project.created',
    entity: 'project',
    entityId: project.id,
    meta: { after: { key: project.key, name: project.name } },
  });
  res.status(201).json(project);
});

projectsRouter.get('/projects/:id', requirePermission('project:read'), async (req, res) => {
  const project = await scoped(ctx(req).workspaceId).project.findFirst({
    where: { id: req.params.id },
    include: { boards: { select: { id: true, name: true } } },
  });
  if (!project) throw notFound('Project');
  res.json(project);
});

projectsRouter.patch('/projects/:id', requirePermission('project:write'), async (req, res) => {
  const auth = ctx(req);
  const patch = parse(updateSchema, req.body);
  const db = scoped(auth.workspaceId);
  const before = await db.project.findFirst({ where: { id: req.params.id } });
  if (!before) throw notFound('Project');
  await db.project.updateMany({ where: { id: before.id }, data: patch });
  const after = await db.project.findFirst({ where: { id: before.id } });
  await recordAudit({
    workspaceId: auth.workspaceId,
    actorId: auth.userId,
    action: 'project.updated',
    entity: 'project',
    entityId: before.id,
    meta: { before: { name: before.name, description: before.description }, after: patch },
  });
  res.json(after);
});

projectsRouter.delete('/projects/:id', requirePermission('project:write'), async (req, res) => {
  const auth = ctx(req);
  const db = scoped(auth.workspaceId);
  const project = await db.project.findFirst({ where: { id: req.params.id } });
  if (!project) throw notFound('Project');
  await db.project.deleteMany({ where: { id: project.id } });
  await recordAudit({
    workspaceId: auth.workspaceId,
    actorId: auth.userId,
    action: 'project.deleted',
    entity: 'project',
    entityId: project.id,
    meta: { before: { key: project.key, name: project.name } },
  });
  res.status(204).end();
});
