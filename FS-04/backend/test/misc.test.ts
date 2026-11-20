import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { scoped } from '../src/lib/scoped';
import { prisma } from '../src/lib/prisma';
import { recordAudit } from '../src/services/audit';
import { computeBurndown } from '../src/services/reports';
import { processNotification } from '../src/jobs/notification';
import { setNotifier } from '../src/services/notifier';
import { app, authAs, sampleIssue } from './helpers/app';
import { prismaMock } from './helpers/prismaMock';

describe('scoped() tenant helper', () => {
  it('forces workspaceId into where clauses, overriding caller-supplied values', async () => {
    await scoped('wsA').issue.findMany({ where: { title: 'x', workspaceId: 'wsB' } as never });
    expect(prismaMock.issue.findMany).toHaveBeenCalledWith({ where: { title: 'x', workspaceId: 'wsA' } });
  });

  it('adds workspaceId to queries that had no where clause', async () => {
    await scoped('wsA').sprint.findMany();
    await scoped('wsA').comment.deleteMany({ where: { id: 'c1' } });
    expect(prismaMock.sprint.findMany).toHaveBeenCalledWith({ where: { workspaceId: 'wsA' } });
    expect(prismaMock.comment.deleteMany).toHaveBeenCalledWith({ where: { id: 'c1', workspaceId: 'wsA' } });
  });

  it('stamps workspaceId on created rows (single and bulk)', async () => {
    await scoped('wsA').project.create({ data: { key: 'K', name: 'n', workspaceId: 'wsB' } });
    await scoped('wsA').boardColumn.createMany({ data: [{ boardId: 'b', name: 'a', position: 0, workspaceId: 'wsB' }] });
    expect(prismaMock.project.create.mock.calls[0][0].data.workspaceId).toBe('wsA');
    expect(prismaMock.boardColumn.createMany.mock.calls[0][0].data[0].workspaceId).toBe('wsA');
  });

  it('does not expose unscoped single-record operations', () => {
    const db = scoped('wsA').issue as Record<string, unknown>;
    expect(db.findUnique).toBeUndefined();
    expect(db.update).toBeUndefined();
    expect(db.delete).toBeUndefined();
  });
});

describe('audit service', () => {
  it('persists actor, action, entity and before/after meta', async () => {
    await recordAudit({
      workspaceId: 'wsA',
      actorId: 'u1',
      action: 'issue.updated',
      entity: 'issue',
      entityId: 'i1',
      meta: { before: { title: 'a' }, after: { title: 'b' } },
    });
    expect(vi.mocked(prisma.auditLog.create)).toHaveBeenCalledWith({
      data: {
        workspaceId: 'wsA',
        actorId: 'u1',
        action: 'issue.updated',
        entity: 'issue',
        entityId: 'i1',
        meta: { before: { title: 'a' }, after: { title: 'b' } },
      },
    });
  });

  it('never breaks the request when the audit insert fails', async () => {
    prismaMock.auditLog.create.mockRejectedValue(new Error('db down'));
    await expect(recordAudit({ workspaceId: 'w', action: 'a', entity: 'e', entityId: 'x' })).resolves.toBeUndefined();
  });

  it('audit log listing is admin-only and tenant-scoped', async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([]);
    prismaMock.auditLog.count.mockResolvedValue(0);
    expect((await request(app).get('/api/audit-logs').set(authAs('VIEWER'))).status).toBe(403);
    const ok = await request(app).get('/api/audit-logs?entity=issue').set(authAs('ADMIN', { workspaceId: 'wsA' }));
    expect(ok.status).toBe(200);
    expect(prismaMock.auditLog.findMany.mock.calls[0][0].where).toMatchObject({ workspaceId: 'wsA', entity: 'issue' });
  });
});

describe('sprint reports', () => {
  it('computes a linear ideal burndown from total points to zero', () => {
    const points = computeBurndown(10, new Date('2026-01-01T00:00:00Z'), new Date('2026-01-06T00:00:00Z'));
    expect(points.map((p) => p.ideal)).toEqual([10, 8, 6, 4, 2, 0]);
    expect(points[0].date).toBe('2026-01-01');
    expect(points.at(-1)?.date).toBe('2026-01-06');
  });

  it('summarises points and issue completion for a sprint', async () => {
    prismaMock.sprint.findFirst.mockResolvedValue({
      id: 's1',
      name: 'Sprint 1',
      goal: null,
      state: 'ACTIVE',
      startDate: new Date('2026-01-01T00:00:00Z'),
      endDate: new Date('2026-01-03T00:00:00Z'),
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });
    prismaMock.issue.findMany.mockResolvedValue([
      sampleIssue({ storyPoints: 5, status: { name: 'Done', category: 'DONE' } }),
      sampleIssue({ storyPoints: 3, status: { name: 'To Do', category: 'TODO' } }),
      sampleIssue({ storyPoints: null, status: { name: 'To Do', category: 'TODO' } }),
    ]);

    const res = await request(app).get('/api/reports/sprints/s1').set(authAs('VIEWER'));
    expect(res.status).toBe(200);
    expect(res.body.totals).toMatchObject({ issues: 3, completedIssues: 1, points: 8, completedPoints: 5, remainingPoints: 3, completionPercent: 33 });
    expect(res.body.byStatus).toEqual({ Done: 1, 'To Do': 2 });
    expect(res.body.burndown).toHaveLength(3);
  });
});

describe('notification job', () => {
  it('sends an assignment notification through the pluggable notifier', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    setNotifier({ send });
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u2', email: 'u2@acme.test', name: 'Uma' });

    const result = await processNotification({
      data: { type: 'issue.assigned', workspaceId: 'wsA', recipientId: 'u2', issueId: 'i1', issueKey: 'PRJ-1', title: 'Fix', actorName: 'Rita' },
    });

    expect(result).toEqual({ sent: true });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'issue.assigned', to: expect.objectContaining({ email: 'u2@acme.test' }) }));
    expect(send.mock.calls[0][0].subject).toContain('PRJ-1');
  });

  it('skips recipients that no longer exist', async () => {
    const send = vi.fn();
    setNotifier({ send });
    prismaMock.user.findUnique.mockResolvedValue(null);
    const result = await processNotification({
      data: { type: 'comment.created', workspaceId: 'wsA', recipientId: 'gone', issueId: 'i', issueKey: 'K-1', title: 't' },
    });
    expect(result).toEqual({ sent: false });
    expect(send).not.toHaveBeenCalled();
  });
});

describe('attachments', () => {
  it('rejects disallowed file types with 415 before anything is stored', async () => {
    prismaMock.issue.findFirst.mockResolvedValue(sampleIssue());
    const res = await request(app)
      .post('/api/issues/issue-1/attachments')
      .set(authAs('MEMBER'))
      .attach('file', Buffer.from('MZ'), { filename: 'virus.exe', contentType: 'application/x-msdownload' });
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_FILE_TYPE');
    expect(prismaMock.attachment.create).not.toHaveBeenCalled();
  });

  it('does not let viewers upload', async () => {
    const res = await request(app)
      .post('/api/issues/issue-1/attachments')
      .set(authAs('VIEWER'))
      .attach('file', Buffer.from('hi'), { filename: 'a.txt', contentType: 'text/plain' });
    expect(res.status).toBe(403);
  });
});
