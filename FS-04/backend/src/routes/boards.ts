import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { scoped } from '../lib/scoped';
import { parse } from '../lib/validate';
import { badRequest, conflict, notFound } from '../lib/errors';
import { ctx, requirePermission } from '../middleware/auth';
import { recordAudit } from '../services/audit';

const category = z.enum(['TODO', 'IN_PROGRESS', 'DONE']);
const columnSchema = z.object({ name: z.string().trim().min(1).max(50), category: category.default('TODO') });
const columnPatchSchema = z
  .object({ name: z.string().trim().min(1).max(50), category })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'At least one field is required');
const orderSchema = z.object({ columnIds: z.array(z.string().min(1)).min(1) });
const transitionsSchema = z.object({
  transitions: z.array(z.object({ fromColumnId: z.string().min(1), toColumnId: z.string().min(1) })).max(500),
});

export const boardsRouter = Router();

async function loadBoard(workspaceId: string, id: string) {
  const board = await scoped(workspaceId).board.findFirst({
    where: { id },
    include: { columns: { orderBy: { position: 'asc' } }, transitions: true },
  });
  if (!board) throw notFound('Board');
  return board;
}

boardsRouter.get('/projects/:projectId/boards', requirePermission('project:read'), async (req, res) => {
  const items = await scoped(ctx(req).workspaceId).board.findMany({
    where: { projectId: req.params.projectId },
    include: { columns: { orderBy: { position: 'asc' } }, transitions: true },
    orderBy: { createdAt: 'asc' },
  });
  res.json({ items });
});

boardsRouter.get('/boards/:id', requirePermission('project:read'), async (req, res) => {
  res.json(await loadBoard(ctx(req).workspaceId, req.params.id));
});

boardsRouter.post('/boards/:id/columns', requirePermission('board:write'), async (req, res) => {
  const auth = ctx(req);
  const body = parse(columnSchema, req.body);
  const board = await loadBoard(auth.workspaceId, req.params.id);
  const column = await scoped(auth.workspaceId).boardColumn.create({
    data: {
      workspaceId: auth.workspaceId,
      boardId: board.id,
      name: body.name,
      category: body.category,
      position: board.columns.length,
    },
  });
  await recordAudit({
    workspaceId: auth.workspaceId,
    actorId: auth.userId,
    action: 'column.created',
    entity: 'board',
    entityId: board.id,
    meta: { after: { columnId: column.id, name: column.name } },
  });
  res.status(201).json(column);
});

// Declared before /:columnId so "order" is not captured as a column id.
boardsRouter.put('/boards/:id/columns/order', requirePermission('board:write'), async (req, res) => {
  const auth = ctx(req);
  const { columnIds } = parse(orderSchema, req.body);
  const board = await loadBoard(auth.workspaceId, req.params.id);
  const existing = new Set(board.columns.map((c) => c.id));
  if (columnIds.length !== existing.size || new Set(columnIds).size !== existing.size || !columnIds.every((id) => existing.has(id))) {
    throw badRequest('columnIds must contain every column of the board exactly once');
  }
  await prisma.$transaction(
    columnIds.map((id, position) =>
      prisma.boardColumn.updateMany({ where: { id, workspaceId: auth.workspaceId, boardId: board.id }, data: { position } }),
    ),
  );
  await recordAudit({
    workspaceId: auth.workspaceId,
    actorId: auth.userId,
    action: 'column.reordered',
    entity: 'board',
    entityId: board.id,
    meta: { before: board.columns.map((c) => c.id), after: columnIds },
  });
  res.json(await loadBoard(auth.workspaceId, board.id));
});

boardsRouter.patch('/boards/:id/columns/:columnId', requirePermission('board:write'), async (req, res) => {
  const auth = ctx(req);
  const patch = parse(columnPatchSchema, req.body);
  const board = await loadBoard(auth.workspaceId, req.params.id);
  const column = board.columns.find((c) => c.id === req.params.columnId);
  if (!column) throw notFound('Column');
  await scoped(auth.workspaceId).boardColumn.updateMany({ where: { id: column.id }, data: patch });
  await recordAudit({
    workspaceId: auth.workspaceId,
    actorId: auth.userId,
    action: 'column.updated',
    entity: 'board',
    entityId: board.id,
    meta: { before: { name: column.name, category: column.category }, after: patch },
  });
  res.json({ ...column, ...patch });
});

boardsRouter.delete('/boards/:id/columns/:columnId', requirePermission('board:write'), async (req, res) => {
  const auth = ctx(req);
  const db = scoped(auth.workspaceId);
  const board = await loadBoard(auth.workspaceId, req.params.id);
  const column = board.columns.find((c) => c.id === req.params.columnId);
  if (!column) throw notFound('Column');
  if ((await db.issue.count({ where: { statusId: column.id } })) > 0) {
    throw conflict('Move or delete the issues in this column first', 'COLUMN_NOT_EMPTY');
  }
  await db.boardColumn.deleteMany({ where: { id: column.id } });
  await recordAudit({
    workspaceId: auth.workspaceId,
    actorId: auth.userId,
    action: 'column.deleted',
    entity: 'board',
    entityId: board.id,
    meta: { before: { columnId: column.id, name: column.name } },
  });
  res.status(204).end();
});

boardsRouter.get('/boards/:id/transitions', requirePermission('project:read'), async (req, res) => {
  const board = await loadBoard(ctx(req).workspaceId, req.params.id);
  res.json({ items: board.transitions, restricted: board.transitions.length > 0 });
});

// Replaces the whole transition set. An empty list reopens the workflow (any move allowed).
boardsRouter.put('/boards/:id/transitions', requirePermission('board:write'), async (req, res) => {
  const auth = ctx(req);
  const { transitions } = parse(transitionsSchema, req.body);
  const board = await loadBoard(auth.workspaceId, req.params.id);
  const ids = new Set(board.columns.map((c) => c.id));
  for (const t of transitions) {
    if (!ids.has(t.fromColumnId) || !ids.has(t.toColumnId)) {
      throw badRequest('Transitions may only reference columns of this board');
    }
    if (t.fromColumnId === t.toColumnId) throw badRequest('A transition must go between two different columns');
  }
  const unique = [...new Map(transitions.map((t) => [`${t.fromColumnId}>${t.toColumnId}`, t])).values()];
  const db = scoped(auth.workspaceId);
  await prisma.$transaction([
    prisma.workflowTransition.deleteMany({ where: { boardId: board.id, workspaceId: auth.workspaceId } }),
    prisma.workflowTransition.createMany({
      data: unique.map((t) => ({ workspaceId: auth.workspaceId, boardId: board.id, ...t })),
    }),
  ]);
  await recordAudit({
    workspaceId: auth.workspaceId,
    actorId: auth.userId,
    action: 'workflow.updated',
    entity: 'board',
    entityId: board.id,
    meta: { before: board.transitions.length, after: unique.length },
  });
  const items = await db.workflowTransition.findMany({ where: { boardId: board.id } });
  res.json({ items, restricted: items.length > 0 });
});
