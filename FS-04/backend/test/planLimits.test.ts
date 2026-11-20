import { describe, expect, it } from 'vitest';
import { assertWithinLimit, effectivePlan, evaluateLimit } from '../src/services/planLimits';
import { PLANS } from '../src/config/plans';
import { AppError } from '../src/lib/errors';
import { prismaMock } from './helpers/prismaMock';

describe('plan limits (pure logic)', () => {
  it('has the documented plan configuration', () => {
    expect(PLANS.FREE).toMatchObject({ maxProjects: 1, maxMembers: 3 });
    expect(PLANS.PRO).toMatchObject({ maxProjects: 10, maxMembers: 25 });
    expect(PLANS.BUSINESS).toMatchObject({ maxProjects: null, maxMembers: null });
  });

  it('blocks the FREE plan at 1 project and 3 members', () => {
    expect(evaluateLimit('FREE', 'projects', 0).allowed).toBe(true);
    expect(evaluateLimit('FREE', 'projects', 1).allowed).toBe(false);
    expect(evaluateLimit('FREE', 'members', 2).allowed).toBe(true);
    expect(evaluateLimit('FREE', 'members', 3).allowed).toBe(false);
  });

  it('blocks PRO at 10 projects / 25 members', () => {
    expect(evaluateLimit('PRO', 'projects', 9).allowed).toBe(true);
    expect(evaluateLimit('PRO', 'projects', 10).allowed).toBe(false);
    expect(evaluateLimit('PRO', 'members', 24).allowed).toBe(true);
    expect(evaluateLimit('PRO', 'members', 25).allowed).toBe(false);
  });

  it('never blocks BUSINESS', () => {
    expect(evaluateLimit('BUSINESS', 'projects', 10_000)).toMatchObject({ allowed: true, limit: null });
    expect(evaluateLimit('BUSINESS', 'members', 10_000).allowed).toBe(true);
  });

  it('falls back to FREE when the subscription is missing or no longer in good standing', () => {
    expect(effectivePlan(null)).toBe('FREE');
    expect(effectivePlan({ plan: 'PRO', status: 'active' })).toBe('PRO');
    expect(effectivePlan({ plan: 'PRO', status: 'trialing' })).toBe('PRO');
    expect(effectivePlan({ plan: 'PRO', status: 'canceled' })).toBe('FREE');
    expect(effectivePlan({ plan: 'BUSINESS', status: 'unpaid' })).toBe('FREE');
  });
});

describe('assertWithinLimit', () => {
  it('throws a 402 PLAN_LIMIT_EXCEEDED with details when over the limit', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue({ plan: 'FREE', status: 'active' });
    prismaMock.project.count.mockResolvedValue(1);
    prismaMock.membership.count.mockResolvedValue(1);

    const err = (await assertWithinLimit('wsA', 'projects').catch((e) => e)) as AppError;
    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(402);
    expect(err.code).toBe('PLAN_LIMIT_EXCEEDED');
    expect(err.details).toMatchObject({ plan: 'FREE', resource: 'projects', limit: 1, current: 1 });
  });

  it('passes when under the limit and counts only the given workspace', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue({ plan: 'PRO', status: 'active' });
    prismaMock.project.count.mockResolvedValue(5);
    prismaMock.membership.count.mockResolvedValue(5);

    await expect(assertWithinLimit('wsA', 'projects')).resolves.toBeUndefined();
    expect(prismaMock.project.count).toHaveBeenCalledWith({ where: { workspaceId: 'wsA' } });
  });
});
