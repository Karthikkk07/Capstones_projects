import type { Plan } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';
import { PLANS, type LimitedResource } from '../config/plans';

const ACTIVE_STATUSES = ['active', 'trialing', 'past_due'];

export interface LimitResult {
  allowed: boolean;
  limit: number | null;
  current: number;
}

/** Pure check: would adding one more `resource` exceed the plan's limit? */
export function evaluateLimit(plan: Plan, resource: LimitedResource, current: number): LimitResult {
  const cfg = PLANS[plan];
  const limit = resource === 'projects' ? cfg.maxProjects : cfg.maxMembers;
  return { allowed: limit === null || current < limit, limit, current };
}

/** A workspace is on its paid plan only while the Stripe subscription is in good standing. */
export function effectivePlan(sub: { plan: Plan; status: string } | null | undefined): Plan {
  if (!sub) return 'FREE';
  return ACTIVE_STATUSES.includes(sub.status) ? sub.plan : 'FREE';
}

export async function getWorkspacePlan(workspaceId: string): Promise<Plan> {
  const sub = await prisma.subscription.findUnique({ where: { workspaceId } });
  return effectivePlan(sub);
}

export async function getUsage(workspaceId: string): Promise<{ projects: number; members: number }> {
  const [projects, members] = await Promise.all([
    prisma.project.count({ where: { workspaceId } }),
    prisma.membership.count({ where: { workspaceId } }),
  ]);
  return { projects, members };
}

/** Throws 402 PLAN_LIMIT_EXCEEDED when the workspace cannot add another project/member. */
export async function assertWithinLimit(workspaceId: string, resource: LimitedResource): Promise<void> {
  const plan = await getWorkspacePlan(workspaceId);
  const usage = await getUsage(workspaceId);
  const result = evaluateLimit(plan, resource, usage[resource]);
  if (!result.allowed) {
    throw new AppError(
      402,
      'PLAN_LIMIT_EXCEEDED',
      `The ${PLANS[plan].name} plan allows at most ${result.limit} ${resource}. Upgrade your plan to add more.`,
      { plan, resource, limit: result.limit, current: result.current },
    );
  }
}
