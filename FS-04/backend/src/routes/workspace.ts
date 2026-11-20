import crypto from 'node:crypto';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { parse } from '../lib/validate';
import { conflict, forbidden, notFound, badRequest } from '../lib/errors';
import { ctx, requirePermission } from '../middleware/auth';
import { recordAudit } from '../services/audit';
import { assertWithinLimit, getWorkspacePlan } from '../services/planLimits';
import { getNotifier } from '../services/notifier';

const assignableRole = z.enum(['ADMIN', 'MEMBER', 'VIEWER']);

const addSchema = z.object({
  email: z.email().transform((v) => v.toLowerCase()),
  role: assignableRole.default('MEMBER'),
  name: z.string().trim().min(1).max(100).optional(),
});
const roleSchema = z.object({ role: assignableRole });

export const workspaceRouter = Router();

workspaceRouter.get('/workspace', requirePermission('workspace:read'), async (req, res) => {
  const auth = ctx(req);
  const workspace = await prisma.workspace.findUnique({ where: { id: auth.workspaceId } });
  if (!workspace) throw notFound('Workspace');
  res.json({
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    role: auth.role,
    plan: await getWorkspacePlan(auth.workspaceId),
  });
});

workspaceRouter.get('/workspace/members', requirePermission('workspace:read'), async (req, res) => {
  const { workspaceId } = ctx(req);
  const memberships = await prisma.membership.findMany({
    where: { workspaceId },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: 'asc' },
  });
  res.json({ items: memberships.map((m) => ({ ...m.user, role: m.role, joinedAt: m.createdAt })) });
});

// Add (invite) a member by email. Unknown emails get an account with a temporary password.
workspaceRouter.post('/workspace/members', requirePermission('member:manage'), async (req, res) => {
  const auth = ctx(req);
  const body = parse(addSchema, req.body);
  await assertWithinLimit(auth.workspaceId, 'members');

  let user = await prisma.user.findUnique({ where: { email: body.email } });
  let temporaryPassword: string | undefined;
  if (user) {
    const existing = await prisma.membership.findUnique({
      where: { userId_workspaceId: { userId: user.id, workspaceId: auth.workspaceId } },
    });
    if (existing) throw conflict('This user is already a member of the workspace', 'ALREADY_MEMBER');
  } else {
    temporaryPassword = crypto.randomBytes(9).toString('base64url');
    user = await prisma.user.create({
      data: {
        email: body.email,
        name: body.name ?? body.email.split('@')[0],
        passwordHash: await bcrypt.hash(temporaryPassword, env.BCRYPT_ROUNDS),
      },
    });
  }

  const membership = await prisma.membership.create({
    data: { userId: user.id, workspaceId: auth.workspaceId, role: body.role },
  });
  await recordAudit({
    workspaceId: auth.workspaceId,
    actorId: auth.userId,
    action: 'member.added',
    entity: 'membership',
    entityId: membership.id,
    meta: { after: { email: user.email, role: body.role } },
  });
  await getNotifier().send({
    to: user,
    subject: 'You were added to a workspace',
    body: `You now have the ${body.role} role.`,
    type: 'member.added',
  });

  res.status(201).json({
    member: { id: user.id, name: user.name, email: user.email, role: membership.role },
    temporaryPassword,
  });
});

async function loadTarget(workspaceId: string, userId: string, actorRole: string) {
  const target = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
  });
  if (!target) throw notFound('Member');
  if (target.role === 'OWNER') throw forbidden('The workspace owner cannot be modified');
  if (target.role === 'ADMIN' && actorRole !== 'OWNER') throw forbidden('Only the owner can modify an admin');
  return target;
}

workspaceRouter.patch('/workspace/members/:userId', requirePermission('member:manage'), async (req, res) => {
  const auth = ctx(req);
  const { role } = parse(roleSchema, req.body);
  const target = await loadTarget(auth.workspaceId, req.params.userId, auth.role);
  if (role === 'ADMIN' && auth.role !== 'OWNER') throw forbidden('Only the owner can grant the admin role');
  const updated = await prisma.membership.update({ where: { id: target.id }, data: { role } });
  await recordAudit({
    workspaceId: auth.workspaceId,
    actorId: auth.userId,
    action: 'member.role_changed',
    entity: 'membership',
    entityId: target.id,
    meta: { before: { role: target.role }, after: { role } },
  });
  res.json({ userId: updated.userId, role: updated.role });
});

workspaceRouter.delete('/workspace/members/:userId', requirePermission('member:manage'), async (req, res) => {
  const auth = ctx(req);
  if (req.params.userId === auth.userId) throw badRequest('You cannot remove yourself');
  const target = await loadTarget(auth.workspaceId, req.params.userId, auth.role);
  await prisma.membership.delete({ where: { id: target.id } });
  await recordAudit({
    workspaceId: auth.workspaceId,
    actorId: auth.userId,
    action: 'member.removed',
    entity: 'membership',
    entityId: target.id,
    meta: { before: { userId: target.userId, role: target.role } },
  });
  res.status(204).end();
});
