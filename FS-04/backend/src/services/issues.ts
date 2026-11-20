import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { scoped } from '../lib/scoped';
import { badRequest, notFound } from '../lib/errors';
import type { AuthContext } from '../middleware/auth';
import { assertTransitionAllowed } from './workflow';
import { recordAudit } from './audit';
import { emitEvent } from './events';
import { queueNotification } from './notify';

export const issueInclude = {
  status: { select: { id: true, name: true, category: true } },
  assignee: { select: { id: true, name: true, email: true } },
  reporter: { select: { id: true, name: true } },
} satisfies Prisma.IssueInclude;

export interface CreateIssueInput {
  projectId: string;
  boardId?: string;
  statusId?: string;
  title: string;
  description?: string | null;
  type?: 'TASK' | 'BUG' | 'STORY' | 'EPIC';
  priority?: 'LOWEST' | 'LOW' | 'MEDIUM' | 'HIGH' | 'HIGHEST';
  assigneeId?: string | null;
  sprintId?: string | null;
  storyPoints?: number | null;
}

export async function assertWorkspaceMember(workspaceId: string, userId: string): Promise<void> {
  const membership = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
    select: { id: true },
  });
  if (!membership) throw badRequest('Assignee must be a member of this workspace');
}

export async function assertSprintOpen(workspaceId: string, sprintId: string, projectId: string): Promise<void> {
  const sprint = await scoped(workspaceId).sprint.findFirst({ where: { id: sprintId, projectId } });
  if (!sprint) throw badRequest('Sprint not found in this project');
  if (sprint.state === 'COMPLETED') throw badRequest('Cannot add issues to a completed sprint');
}

export async function actorName(userId: string): Promise<string | undefined> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  return user?.name;
}

export async function findIssueByIdOrKey(workspaceId: string, idOrKey: string) {
  const issue = await scoped(workspaceId).issue.findFirst({
    where: { OR: [{ id: idOrKey }, { key: idOrKey }] },
    include: issueInclude,
  });
  if (!issue) throw notFound('Issue');
  return issue;
}

export async function notifyAssignee(
  auth: AuthContext,
  issue: { id: string; key: string; title: string },
  assigneeId: string | null | undefined,
): Promise<void> {
  if (!assigneeId || assigneeId === auth.userId) return;
  queueNotification({
    type: 'issue.assigned',
    workspaceId: auth.workspaceId,
    recipientId: assigneeId,
    issueId: issue.id,
    issueKey: issue.key,
    title: issue.title,
    actorName: await actorName(auth.userId),
  });
}

export async function createIssue(auth: AuthContext, input: CreateIssueInput) {
  const { workspaceId } = auth;
  const db = scoped(workspaceId);

  const project = await db.project.findFirst({ where: { id: input.projectId } });
  if (!project) throw notFound('Project');

  const board = await db.board.findFirst({
    where: { projectId: project.id, ...(input.boardId ? { id: input.boardId } : {}) },
    orderBy: { createdAt: 'asc' },
  });
  if (!board) throw notFound('Board');

  const columns = await db.boardColumn.findMany({ where: { boardId: board.id }, orderBy: { position: 'asc' } });
  const status = input.statusId ? columns.find((c) => c.id === input.statusId) : columns[0];
  if (!status) throw badRequest('Status does not belong to this board');

  if (input.assigneeId) await assertWorkspaceMember(workspaceId, input.assigneeId);
  if (input.sprintId) await assertSprintOpen(workspaceId, input.sprintId, project.id);

  const issue = await prisma.$transaction(async (tx) => {
    // The project row was loaded through the tenant-scoped client above, so this id is known to be ours.
    const { issueCounter } = await tx.project.update({
      where: { id: project.id },
      data: { issueCounter: { increment: 1 } },
      select: { issueCounter: true },
    });
    const position = await tx.issue.count({ where: { workspaceId, statusId: status.id } });
    return tx.issue.create({
      data: {
        workspaceId,
        projectId: project.id,
        boardId: board.id,
        statusId: status.id,
        number: issueCounter,
        key: `${project.key}-${issueCounter}`,
        title: input.title,
        description: input.description ?? null,
        type: input.type ?? 'TASK',
        priority: input.priority ?? 'MEDIUM',
        assigneeId: input.assigneeId ?? null,
        reporterId: auth.userId,
        position,
        sprintId: input.sprintId ?? null,
        storyPoints: input.storyPoints ?? null,
      },
      include: issueInclude,
    });
  });

  await recordAudit({
    workspaceId,
    actorId: auth.userId,
    action: 'issue.created',
    entity: 'issue',
    entityId: issue.id,
    meta: { after: { key: issue.key, title: issue.title, status: issue.status.name, assigneeId: issue.assigneeId } },
  });
  await emitEvent(workspaceId, 'issue.created', issue);
  await notifyAssignee(auth, issue, issue.assigneeId);
  return issue;
}

export async function moveIssue(auth: AuthContext, idOrKey: string, toColumnId: string, position?: number) {
  const { workspaceId } = auth;
  const db = scoped(workspaceId);
  const issue = await findIssueByIdOrKey(workspaceId, idOrKey);

  const [columns, transitions] = await Promise.all([
    db.boardColumn.findMany({ where: { boardId: issue.boardId }, orderBy: { position: 'asc' } }),
    db.workflowTransition.findMany({ where: { boardId: issue.boardId } }),
  ]);
  const target = columns.find((c) => c.id === toColumnId);
  if (!target) throw badRequest('Target column does not belong to the issue\'s board');
  const source = columns.find((c) => c.id === issue.statusId);
  assertTransitionAllowed(issue.statusId, toColumnId, transitions, {
    from: source?.name ?? issue.status.name,
    to: target.name,
  });

  const siblings = await db.issue.findMany({
    where: { statusId: toColumnId, id: { not: issue.id } },
    orderBy: { position: 'asc' },
    select: { id: true },
  });
  const index = Math.max(0, Math.min(position ?? siblings.length, siblings.length));
  const ordered = [...siblings.map((s) => s.id)];
  ordered.splice(index, 0, issue.id);

  await prisma.$transaction(
    ordered.map((id, i) =>
      prisma.issue.updateMany({
        where: { id, workspaceId },
        data: id === issue.id ? { statusId: toColumnId, position: i } : { position: i },
      }),
    ),
  );

  const updated = await findIssueByIdOrKey(workspaceId, issue.id);
  const statusChanged = issue.statusId !== toColumnId;
  await recordAudit({
    workspaceId,
    actorId: auth.userId,
    action: 'issue.moved',
    entity: 'issue',
    entityId: issue.id,
    meta: {
      before: { status: issue.status.name, position: issue.position },
      after: { status: updated.status.name, position: updated.position },
    },
  });
  await emitEvent(workspaceId, 'issue.moved', { ...updated, previousStatusId: issue.statusId, statusChanged });
  return updated;
}
