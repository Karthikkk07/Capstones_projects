import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { scoped } from '../lib/scoped';
import { parse } from '../lib/validate';
import { badRequest, conflict, notFound } from '../lib/errors';
import { ctx, requirePermission } from '../middleware/auth';
import { recordAudit } from '../services/audit';
import { emitEvent } from '../services/events';
import { enqueue, QUEUES } from '../lib/queue';
import { buildSprintReport } from '../services/reports';

const dateField = z.coerce.date();
const createSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    goal: z.string().max(500).nullish(),
    startDate: dateField.nullish(),
    endDate: dateField.nullish(),
  })
  .refine((v) => !v.startDate || !v.endDate || v.endDate > v.startDate, 'endDate must be after startDate');
const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    goal: z.string().max(500).nullable(),
    startDate: dateField.nullable(),
    endDate: dateField.nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'At least one field is required');
const completeSchema = z.object({ moveIncompleteTo: z.string().min(1).nullish() }); // sprint id, or omitted for backlog

export const sprintsRouter = Router();

async function loadSprint(workspaceId: string, id: string) {
  const sprint = await scoped(workspaceId).sprint.findFirst({ where: { id } });
  if (!sprint) throw notFound('Sprint');
  return sprint;
}

sprintsRouter.get('/projects/:projectId/sprints', requirePermission('sprint:read'), async (req, res) => {
  const items = await scoped(ctx(req).workspaceId).sprint.findMany({
    where: { projectId: req.params.projectId },
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { issues: true } } },
  });
  res.json({ items });
});

sprintsRouter.post('/projects/:projectId/sprints', requirePermission('sprint:write'), async (req, res) => {
  const auth = ctx(req);
  const body = parse(createSchema, req.body);
  const db = scoped(auth.workspaceId);
  const project = await db.project.findFirst({ where: { id: req.params.projectId } });
  if (!project) throw notFound('Project');
  const sprint = await db.sprint.create({
    data: {
      workspaceId: auth.workspaceId,
      projectId: project.id,
      name: body.name,
      goal: body.goal ?? null,
      startDate: body.startDate ?? null,
      endDate: body.endDate ?? null,
    },
  });
  await recordAudit({
    workspaceId: auth.workspaceId,
    actorId: auth.userId,
    action: 'sprint.created',
    entity: 'sprint',
    entityId: sprint.id,
    meta: { after: { name: sprint.name } },
  });
  res.status(201).json(sprint);
});

sprintsRouter.patch('/sprints/:id', requirePermission('sprint:write'), async (req, res) => {
  const auth = ctx(req);
  const patch = parse(updateSchema, req.body);
  const before = await loadSprint(auth.workspaceId, req.params.id);
  if (before.state === 'COMPLETED') throw conflict('Completed sprints cannot be edited', 'SPRINT_COMPLETED');
  await scoped(auth.workspaceId).sprint.updateMany({ where: { id: before.id }, data: patch });
  await recordAudit({
    workspaceId: auth.workspaceId,
    actorId: auth.userId,
    action: 'sprint.updated',
    entity: 'sprint',
    entityId: before.id,
    meta: { before: { name: before.name, goal: before.goal }, after: patch },
  });
  res.json(await loadSprint(auth.workspaceId, before.id));
});

sprintsRouter.post('/sprints/:id/start', requirePermission('sprint:write'), async (req, res) => {
  const auth = ctx(req);
  const db = scoped(auth.workspaceId);
  const sprint = await loadSprint(auth.workspaceId, req.params.id);
  if (sprint.state !== 'PLANNED') throw conflict('Only planned sprints can be started', 'INVALID_SPRINT_STATE');
  if (await db.sprint.findFirst({ where: { projectId: sprint.projectId, state: 'ACTIVE' } })) {
    throw conflict('This project already has an active sprint', 'SPRINT_ALREADY_ACTIVE');
  }
  const startDate = sprint.startDate ?? new Date();
  const endDate = sprint.endDate ?? new Date(startDate.getTime() + 14 * 24 * 60 * 60 * 1000);
  await db.sprint.updateMany({ where: { id: sprint.id }, data: { state: 'ACTIVE', startDate, endDate } });
  const updated = await loadSprint(auth.workspaceId, sprint.id);
  await recordAudit({
    workspaceId: auth.workspaceId,
    actorId: auth.userId,
    action: 'sprint.started',
    entity: 'sprint',
    entityId: sprint.id,
    meta: { before: { state: sprint.state }, after: { state: 'ACTIVE', startDate, endDate } },
  });
  await emitEvent(auth.workspaceId, 'sprint.started', updated);
  res.json(updated);
});

sprintsRouter.post('/sprints/:id/complete', requirePermission('sprint:write'), async (req, res) => {
  const auth = ctx(req);
  const { moveIncompleteTo } = parse(completeSchema, req.body ?? {});
  const db = scoped(auth.workspaceId);
  const sprint = await loadSprint(auth.workspaceId, req.params.id);
  if (sprint.state !== 'ACTIVE') throw conflict('Only active sprints can be completed', 'INVALID_SPRINT_STATE');

  if (moveIncompleteTo) {
    const target = await db.sprint.findFirst({ where: { id: moveIncompleteTo, projectId: sprint.projectId } });
    if (!target || target.state !== 'PLANNED') throw badRequest('moveIncompleteTo must be a planned sprint of this project');
  }

  // Snapshot the report before incomplete issues leave the sprint.
  const report = await buildSprintReport(auth.workspaceId, sprint.id);
  const incomplete = await db.issue.findMany({
    where: { sprintId: sprint.id, status: { category: { not: 'DONE' } } },
    select: { id: true },
  });
  await prisma.$transaction([
    prisma.issue.updateMany({
      where: { workspaceId: auth.workspaceId, id: { in: incomplete.map((i) => i.id) } },
      data: { sprintId: moveIncompleteTo ?? null },
    }),
    prisma.sprint.updateMany({
      where: { id: sprint.id, workspaceId: auth.workspaceId },
      data: { state: 'COMPLETED', completedAt: new Date() },
    }),
  ]);

  const updated = await loadSprint(auth.workspaceId, sprint.id);
  await recordAudit({
    workspaceId: auth.workspaceId,
    actorId: auth.userId,
    action: 'sprint.completed',
    entity: 'sprint',
    entityId: sprint.id,
    meta: { before: { state: sprint.state }, after: { state: 'COMPLETED', movedIssues: incomplete.length } },
  });
  await emitEvent(auth.workspaceId, 'sprint.completed', { ...updated, movedIssues: incomplete.length });
  enqueue(QUEUES.sprintReports, 'sprint-completed', { workspaceId: auth.workspaceId, sprintId: sprint.id });
  res.json({ sprint: updated, movedIssues: incomplete.length, report });
});
