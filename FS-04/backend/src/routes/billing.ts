import express, { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env';
import { PLANS, PAID_PLANS } from '../config/plans';
import { prisma } from '../lib/prisma';
import { parse } from '../lib/validate';
import { unauthorized } from '../lib/errors';
import { ctx, requirePermission } from '../middleware/auth';
import { effectivePlan, getUsage } from '../services/planLimits';
import {
  constructStripeEvent,
  createCheckoutSession,
  createPortalSession,
  handleStripeEvent,
} from '../services/billing';

const checkoutSchema = z.object({ plan: z.enum(PAID_PLANS as ['PRO', 'BUSINESS']) });

/**
 * Mounted BEFORE express.json() in app.ts: Stripe signature verification needs the raw bytes.
 * The tenant is taken from the signed event's metadata that we attached at checkout time.
 */
export const stripeWebhookRouter = Router();
stripeWebhookRouter.post('/billing/webhook', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
  const event = constructStripeEvent(req.body as Buffer, req.header('stripe-signature'));
  const handled = await handleStripeEvent(event);
  res.json({ received: true, handled });
});

export const billingRouter = Router();

billingRouter.get('/billing', requirePermission('billing:read'), async (req, res) => {
  const { workspaceId } = ctx(req);
  const [sub, usage] = await Promise.all([
    prisma.subscription.findUnique({ where: { workspaceId } }),
    getUsage(workspaceId),
  ]);
  const plan = effectivePlan(sub);
  res.json({
    plan,
    status: sub?.status ?? 'active',
    currentPeriodEnd: sub?.currentPeriodEnd ?? null,
    hasBillingAccount: !!sub?.stripeCustomerId,
    stripeConfigured: !!env.STRIPE_SECRET_KEY,
    limits: { projects: PLANS[plan].maxProjects, members: PLANS[plan].maxMembers },
    usage,
    plans: Object.entries(PLANS).map(([id, p]) => ({ id, ...p })),
  });
});

billingRouter.post('/billing/checkout', requirePermission('billing:manage'), async (req, res) => {
  const auth = ctx(req);
  const { plan } = parse(checkoutSchema, req.body);
  const user = await prisma.user.findUnique({ where: { id: auth.userId }, select: { email: true } });
  if (!user) throw unauthorized();
  res.json(await createCheckoutSession({ workspaceId: auth.workspaceId, email: user.email, plan }));
});

billingRouter.post('/billing/portal', requirePermission('billing:manage'), async (req, res) => {
  res.json(await createPortalSession(ctx(req).workspaceId));
});
