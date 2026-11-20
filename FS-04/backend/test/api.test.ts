import { describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { enqueue } from '../src/lib/queue';
import { app, authAs, sampleIssue } from './helpers/app';
import { prismaMock } from './helpers/prismaMock';

describe('authentication', () => {
  it('serves /health without auth', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('rejects requests without a token', async () => {
    const res = await request(app).get('/api/issues');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects tokens signed with a different secret', async () => {
    const forged = jwt.sign({ sub: 'user-1', wid: 'wsA' }, 'not-the-secret');
    const res = await request(app).get('/api/issues').set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });

  it('rejects a valid token whose user is not a member of the workspace in the token', async () => {
    const headers = authAs('MEMBER');
    prismaMock.membership.findUnique.mockResolvedValue(null);
    const res = await request(app).get('/api/issues').set(headers);
    expect(res.status).toBe(401);
  });

  it('registers a user, creating a workspace with an OWNER membership and returning a JWT', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.create.mockResolvedValue({ id: 'u1', email: 'new@acme.test', name: 'Neo' });
    prismaMock.workspace.create.mockResolvedValue({ id: 'w1', name: 'Neo Inc', slug: 'neo-inc-abc' });

    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'NEW@acme.test', password: 'supersecret1', name: 'Neo', workspaceName: 'Neo Inc' });

    expect(res.status).toBe(201);
    expect(res.body.role).toBe('OWNER');
    expect(jwt.decode(res.body.token)).toMatchObject({ sub: 'u1', wid: 'w1' });
    expect(prismaMock.user.create.mock.calls[0][0].data.email).toBe('new@acme.test');
    expect(prismaMock.membership.create.mock.calls[0][0].data).toMatchObject({ userId: 'u1', workspaceId: 'w1', role: 'OWNER' });
    expect(prismaMock.subscription.create.mock.calls[0][0].data).toMatchObject({ workspaceId: 'w1', plan: 'FREE' });
    expect(prismaMock.auditLog.create.mock.calls[0][0].data.action).toBe('workspace.created');
  });

  it('refuses to register an email that already exists', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u1' });
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'a@b.co', password: 'supersecret1', name: 'A', workspaceName: 'AB' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('logs in with correct credentials and rejects a wrong password with the same generic error', async () => {
    const passwordHash = await bcrypt.hash('correct-horse', 4);
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'a@b.co',
      name: 'A',
      passwordHash,
      memberships: [{ workspaceId: 'w1', role: 'ADMIN', workspace: { id: 'w1', name: 'W', slug: 'w' } }],
    });

    const ok = await request(app).post('/api/auth/login').send({ email: 'a@b.co', password: 'correct-horse' });
    expect(ok.status).toBe(200);
    expect(ok.body.role).toBe('ADMIN');
    expect(jwt.decode(ok.body.token)).toMatchObject({ sub: 'u1', wid: 'w1' });

    const bad = await request(app).post('/api/auth/login').send({ email: 'a@b.co', password: 'wrong' });
    expect(bad.status).toBe(401);
    expect(bad.body.error.message).toBe('Invalid email or password');
  });
});

describe('tenant isolation', () => {
  // Simulates the database: the issue exists only in workspace B.
  const issueInB = sampleIssue({ id: 'issue-b', workspaceId: 'wsB', key: 'B-1' });
  const dbFindFirst = ({ where }: { where: { workspaceId: string } }) =>
    Promise.resolve(where.workspaceId === 'wsB' ? issueInB : null);

  it("returns 404 when a user from workspace A requests workspace B's issue", async () => {
    prismaMock.issue.findFirst.mockImplementation(dbFindFirst);
    const res = await request(app).get('/api/issues/issue-b').set(authAs('OWNER', { workspaceId: 'wsA' }));

    expect(res.status).toBe(404);
    expect(prismaMock.issue.findFirst.mock.calls[0][0].where).toMatchObject({ workspaceId: 'wsA' });
  });

  it('still serves the same issue to a user of workspace B', async () => {
    prismaMock.issue.findFirst.mockImplementation(dbFindFirst);
    const res = await request(app).get('/api/issues/issue-b').set(authAs('VIEWER', { workspaceId: 'wsB' }));
    expect(res.status).toBe(200);
    expect(res.body.key).toBe('B-1');
  });

  it('scopes list queries to the token workspace and ignores a client-supplied workspaceId', async () => {
    prismaMock.issue.findMany.mockResolvedValue([]);
    prismaMock.issue.count.mockResolvedValue(0);
    const res = await request(app)
      .get('/api/issues?workspaceId=wsB')
      .set('X-Workspace-Id', 'wsB')
      .set(authAs('MEMBER', { workspaceId: 'wsA' }));

    expect(res.status).toBe(200);
    expect(prismaMock.issue.findMany.mock.calls[0][0].where.workspaceId).toBe('wsA');
    expect(prismaMock.issue.count.mock.calls[0][0].where.workspaceId).toBe('wsA');
  });

  it('cannot move or comment on another workspace issue (404, nothing written)', async () => {
    prismaMock.issue.findFirst.mockImplementation(dbFindFirst);
    const headers = authAs('ADMIN', { workspaceId: 'wsA' });

    const move = await request(app).post('/api/issues/issue-b/move').set(headers).send({ toColumnId: 'c2' });
    const comment = await request(app).post('/api/issues/issue-b/comments').set(headers).send({ body: 'hi' });

    expect(move.status).toBe(404);
    expect(comment.status).toBe(404);
    expect(prismaMock.issue.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.comment.create).not.toHaveBeenCalled();
  });
});

describe('role enforcement and issue creation', () => {
  const payload = { projectId: 'p1', title: 'New bug', type: 'BUG' };

  function mockCreateFlow() {
    prismaMock.project.findFirst.mockResolvedValue({ id: 'p1', key: 'PRJ' });
    prismaMock.board.findFirst.mockResolvedValue({ id: 'b1' });
    prismaMock.boardColumn.findMany.mockResolvedValue([{ id: 'c1', name: 'To Do' }]);
    prismaMock.project.update.mockResolvedValue({ issueCounter: 7 });
    prismaMock.issue.count.mockResolvedValue(2);
    prismaMock.issue.create.mockImplementation(async ({ data }) => sampleIssue({ ...data, id: 'issue-7' }));
    prismaMock.webhook.findMany.mockResolvedValue([{ id: 'h1' }]);
  }

  it('forbids a VIEWER from creating an issue (403) without touching the database', async () => {
    const res = await request(app).post('/api/issues').set(authAs('VIEWER')).send(payload);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(prismaMock.issue.create).not.toHaveBeenCalled();
  });

  it('forbids a MEMBER from creating a project or a webhook, and from reading the audit log', async () => {
    const headers = authAs('MEMBER');
    expect((await request(app).post('/api/projects').set(headers).send({ key: 'ABC', name: 'x' })).status).toBe(403);
    expect((await request(app).post('/api/webhooks').set(headers).send({})).status).toBe(403);
    expect((await request(app).get('/api/audit-logs').set(headers)).status).toBe(403);
  });

  it('lets a MEMBER create an issue with a sequential key, a tenant-stamped row, an audit entry and a webhook job', async () => {
    mockCreateFlow();
    const res = await request(app)
      .post('/api/issues')
      .set(authAs('MEMBER', { userId: 'user-9', workspaceId: 'wsA' }))
      .send({ ...payload, workspaceId: 'wsB' }); // must be ignored

    expect(res.status).toBe(201);
    expect(res.body.key).toBe('PRJ-7');

    const created = prismaMock.issue.create.mock.calls[0][0].data;
    expect(created).toMatchObject({ workspaceId: 'wsA', reporterId: 'user-9', number: 7, key: 'PRJ-7', position: 2 });
    expect(prismaMock.project.findFirst.mock.calls[0][0].where).toMatchObject({ id: 'p1', workspaceId: 'wsA' });

    expect(enqueue).toHaveBeenCalledWith('webhook-delivery', 'issue.created', expect.objectContaining({ webhookId: 'h1', workspaceId: 'wsA' }));
  });

  it('writes an audit log entry for every create (actor, action, entity, after-state)', async () => {
    mockCreateFlow();
    await request(app).post('/api/issues').set(authAs('ADMIN', { userId: 'user-2' })).send(payload);

    expect(prismaMock.auditLog.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.auditLog.create.mock.calls[0][0].data).toMatchObject({
      workspaceId: 'wsA',
      actorId: 'user-2',
      action: 'issue.created',
      entity: 'issue',
      entityId: 'issue-7',
      meta: { after: { key: 'PRJ-7', title: 'New bug' } },
    });
  });

  it('notifies an assignee other than the actor', async () => {
    mockCreateFlow();
    await request(app).post('/api/issues').set(authAs('MEMBER', { userId: 'user-1' })).send({ ...payload, assigneeId: 'user-5' });
    expect(enqueue).toHaveBeenCalledWith('notifications', 'issue.assigned', expect.objectContaining({ recipientId: 'user-5' }));
  });

  it('validates input with zod and returns field details', async () => {
    const res = await request(app).post('/api/issues').set(authAs('MEMBER')).send({ projectId: 'p1', title: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0].path).toBe('title');
  });
});

describe('moving issues through the workflow', () => {
  const columns = [
    { id: 'c1', name: 'To Do', position: 0 },
    { id: 'c2', name: 'In Progress', position: 1 },
    { id: 'c3', name: 'Done', position: 2 },
  ];

  it('rejects a move the board workflow forbids with 409', async () => {
    prismaMock.issue.findFirst.mockResolvedValue(sampleIssue());
    prismaMock.boardColumn.findMany.mockResolvedValue(columns);
    prismaMock.workflowTransition.findMany.mockResolvedValue([{ fromColumnId: 'c1', toColumnId: 'c2' }]);

    const res = await request(app).post('/api/issues/issue-1/move').set(authAs('MEMBER')).send({ toColumnId: 'c3', position: 0 });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('WORKFLOW_TRANSITION_NOT_ALLOWED');
    expect(prismaMock.issue.updateMany).not.toHaveBeenCalled();
  });

  it('moves an allowed transition, re-numbers the target column and audits it', async () => {
    prismaMock.issue.findFirst
      .mockResolvedValueOnce(sampleIssue())
      .mockResolvedValue(sampleIssue({ statusId: 'c2', position: 1, status: { id: 'c2', name: 'In Progress', category: 'IN_PROGRESS' } }));
    prismaMock.boardColumn.findMany.mockResolvedValue(columns);
    prismaMock.workflowTransition.findMany.mockResolvedValue([{ fromColumnId: 'c1', toColumnId: 'c2' }]);
    prismaMock.issue.findMany.mockResolvedValue([{ id: 'x' }, { id: 'y' }]);
    prismaMock.issue.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.webhook.findMany.mockResolvedValue([]);

    const res = await request(app).post('/api/issues/issue-1/move').set(authAs('MEMBER')).send({ toColumnId: 'c2', position: 1 });

    expect(res.status).toBe(200);
    const updates = prismaMock.issue.updateMany.mock.calls.map((c) => c[0]);
    expect(updates.map((u) => u.where.id)).toEqual(['x', 'issue-1', 'y']);
    expect(updates[1].data).toEqual({ statusId: 'c2', position: 1 });
    expect(updates.every((u) => u.where.workspaceId === 'wsA')).toBe(true);
    expect(prismaMock.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: 'issue.moved', entityId: 'issue-1' });
  });

  it('forbids viewers from moving issues', async () => {
    const res = await request(app).post('/api/issues/issue-1/move').set(authAs('VIEWER')).send({ toColumnId: 'c2' });
    expect(res.status).toBe(403);
  });
});

describe('plan limits through the API', () => {
  it('returns 402 when a FREE workspace tries to create a second project', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue({ plan: 'FREE', status: 'active' });
    prismaMock.project.count.mockResolvedValue(1);
    prismaMock.membership.count.mockResolvedValue(1);

    const res = await request(app).post('/api/projects').set(authAs('ADMIN')).send({ key: 'two', name: 'Second' });

    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe('PLAN_LIMIT_EXCEEDED');
    expect(prismaMock.project.create).not.toHaveBeenCalled();
  });

  it('creates a project with a default board on a PRO workspace', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue({ plan: 'PRO', status: 'active' });
    prismaMock.project.count.mockResolvedValue(1);
    prismaMock.membership.count.mockResolvedValue(1);
    prismaMock.project.findFirst.mockResolvedValue(null);
    prismaMock.project.create.mockResolvedValue({ id: 'p2', key: 'TWO', name: 'Second' });
    prismaMock.board.create.mockResolvedValue({ id: 'b2' });

    const res = await request(app).post('/api/projects').set(authAs('ADMIN')).send({ key: 'two', name: 'Second' });

    expect(res.status).toBe(201);
    expect(prismaMock.project.create.mock.calls[0][0].data).toMatchObject({ key: 'TWO', workspaceId: 'wsA' });
    expect(prismaMock.boardColumn.createMany.mock.calls[0][0].data).toHaveLength(3);
    expect(prismaMock.auditLog.create.mock.calls[0][0].data.action).toBe('project.created');
  });

  it('returns 402 when adding a 4th member to a FREE workspace', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue(null);
    prismaMock.project.count.mockResolvedValue(0);
    prismaMock.membership.count.mockResolvedValue(3);

    const res = await request(app).post('/api/workspace/members').set(authAs('ADMIN')).send({ email: 'x@y.co', role: 'MEMBER' });
    expect(res.status).toBe(402);
    expect(res.body.error.details).toMatchObject({ resource: 'members', limit: 3 });
  });
});
