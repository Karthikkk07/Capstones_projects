import crypto from 'node:crypto';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { parse } from '../lib/validate';
import { conflict, unauthorized } from '../lib/errors';
import { signToken } from '../lib/jwt';
import { authenticate, ctx } from '../middleware/auth';
import { permissionsFor } from '../permissions';
import { recordAudit } from '../services/audit';
import { getWorkspacePlan } from '../services/planLimits';

const email = z.email().transform((v) => v.toLowerCase());

const registerSchema = z.object({
  email,
  password: z.string().min(8).max(100),
  name: z.string().trim().min(1).max(100),
  workspaceName: z.string().trim().min(2).max(100),
});

const loginSchema = z.object({
  email,
  password: z.string().min(1).max(100),
  workspaceId: z.string().optional(),
});

const switchSchema = z.object({ workspaceId: z.string().min(1) });

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'workspace';

const publicUser = (u: { id: string; email: string; name: string }) => ({ id: u.id, email: u.email, name: u.name });

export const authRouter = Router();

authRouter.post('/auth/register', async (req, res) => {
  const body = parse(registerSchema, req.body);
  if (await prisma.user.findUnique({ where: { email: body.email } })) {
    throw conflict('An account with this email already exists', 'EMAIL_TAKEN');
  }
  const passwordHash = await bcrypt.hash(body.password, env.BCRYPT_ROUNDS);

  const { user, workspace } = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { email: body.email, name: body.name, passwordHash } });
    const workspace = await tx.workspace.create({
      data: { name: body.workspaceName, slug: `${slugify(body.workspaceName)}-${crypto.randomBytes(3).toString('hex')}` },
    });
    await tx.membership.create({ data: { userId: user.id, workspaceId: workspace.id, role: 'OWNER' } });
    await tx.subscription.create({ data: { workspaceId: workspace.id, plan: 'FREE', status: 'active' } });
    return { user, workspace };
  });

  await recordAudit({
    workspaceId: workspace.id,
    actorId: user.id,
    action: 'workspace.created',
    entity: 'workspace',
    entityId: workspace.id,
    meta: { after: { name: workspace.name } },
  });

  res.status(201).json({
    token: signToken(user.id, workspace.id),
    user: publicUser(user),
    workspace: { id: workspace.id, name: workspace.name, slug: workspace.slug },
    role: 'OWNER',
  });
});

authRouter.post('/auth/login', async (req, res) => {
  const body = parse(loginSchema, req.body);
  const user = await prisma.user.findUnique({
    where: { email: body.email },
    include: { memberships: { include: { workspace: true }, orderBy: { createdAt: 'asc' } } },
  });
  // Same error for unknown email and wrong password to avoid account enumeration.
  if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) {
    throw unauthorized('Invalid email or password');
  }
  const membership = body.workspaceId
    ? user.memberships.find((m) => m.workspaceId === body.workspaceId)
    : user.memberships[0];
  if (!membership) throw unauthorized('You are not a member of that workspace');

  res.json({
    token: signToken(user.id, membership.workspaceId),
    user: publicUser(user),
    workspace: { id: membership.workspace.id, name: membership.workspace.name, slug: membership.workspace.slug },
    role: membership.role,
  });
});

authRouter.get('/auth/me', authenticate, async (req, res) => {
  const auth = ctx(req);
  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    include: { memberships: { include: { workspace: true } } },
  });
  if (!user) throw unauthorized();
  const current = user.memberships.find((m) => m.workspaceId === auth.workspaceId);
  res.json({
    user: publicUser(user),
    workspace: current && { id: current.workspace.id, name: current.workspace.name, slug: current.workspace.slug },
    role: auth.role,
    permissions: permissionsFor(auth.role),
    plan: await getWorkspacePlan(auth.workspaceId),
    workspaces: user.memberships.map((m) => ({ id: m.workspace.id, name: m.workspace.name, role: m.role })),
  });
});

authRouter.post('/auth/switch-workspace', authenticate, async (req, res) => {
  const auth = ctx(req);
  const { workspaceId } = parse(switchSchema, req.body);
  const membership = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId: auth.userId, workspaceId } },
    include: { workspace: true },
  });
  if (!membership) throw unauthorized('You are not a member of that workspace');
  res.json({
    token: signToken(auth.userId, workspaceId),
    workspace: { id: membership.workspace.id, name: membership.workspace.name, slug: membership.workspace.slug },
    role: membership.role,
  });
});
