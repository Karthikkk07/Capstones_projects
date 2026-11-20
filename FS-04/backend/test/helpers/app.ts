import type { Role } from '@prisma/client';
import { createApp } from '../../src/app';
import { signToken } from '../../src/lib/jwt';
import { prismaMock } from './prismaMock';

export const app = createApp();

/** Returns an Authorization header for a user whose membership in `workspaceId` has `role`. */
export function authAs(role: Role, opts: { userId?: string; workspaceId?: string } = {}) {
  const { userId = 'user-1', workspaceId = 'wsA' } = opts;
  prismaMock.membership.findUnique.mockResolvedValue({ role });
  return { Authorization: `Bearer ${signToken(userId, workspaceId)}` };
}

export const sampleIssue = (over: Record<string, unknown> = {}) => ({
  id: 'issue-1',
  workspaceId: 'wsA',
  projectId: 'p1',
  boardId: 'b1',
  statusId: 'c1',
  key: 'PRJ-1',
  title: 'Fix login',
  position: 0,
  sprintId: null,
  assigneeId: null,
  status: { id: 'c1', name: 'To Do', category: 'TODO' },
  assignee: null,
  reporter: { id: 'user-1', name: 'Rita' },
  ...over,
});
