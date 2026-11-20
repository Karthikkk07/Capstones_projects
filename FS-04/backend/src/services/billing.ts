import type Stripe from 'stripe';
import type { Plan } from '@prisma/client';
import { env } from '../config/env';
import { PAID_PLANS } from '../config/plans';
import { prisma } from '../lib/prisma';
import { getStripe } from '../lib/stripe';
import { AppError, badRequest } from '../lib/errors';
import { recordAudit } from './audit';

const PLAN_VALUES: Plan[] = ['FREE', 'PRO', 'BUSINESS'];

export function priceIdFor(plan: Plan): string | undefined {
  if (plan === 'PRO') return env.STRIPE_PRICE_PRO;
  if (plan === 'BUSINESS') return env.STRIPE_PRICE_BUSINESS;
  return undefined;
}

function parsePlan(value: unknown): Plan | null {
  return typeof value === 'string' && PLAN_VALUES.includes(value as Plan) ? (value as Plan) : null;
}

function planFromPriceId(priceId: string | undefined): Plan | null {
  if (!priceId) return null;
  return PAID_PLANS.find((p) => priceIdFor(p) === priceId) ?? null;
}

export async function createCheckoutSession(opts: { workspaceId: string; email: string; plan: Plan }) {
  if (!PAID_PLANS.includes(opts.plan)) throw badRequest('Only PRO and BUSINESS can be purchased');
  const stripe = getStripe();
  const price = priceIdFor(opts.plan);
  if (!price) {
    throw new AppError(503, 'BILLING_NOT_CONFIGURED', `No Stripe price configured for plan ${opts.plan}`);
  }

  const existing = await prisma.subscription.findUnique({ where: { workspaceId: opts.workspaceId } });
  let customerId = existing?.stripeCustomerId ?? undefined;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: opts.email,
      metadata: { workspaceId: opts.workspaceId },
    });
    customerId = customer.id;
    await prisma.subscription.upsert({
      where: { workspaceId: opts.workspaceId },
      create: { workspaceId: opts.workspaceId, plan: 'FREE', status: 'active', stripeCustomerId: customerId },
      update: { stripeCustomerId: customerId },
    });
  }

  const metadata = { workspaceId: opts.workspaceId, plan: opts.plan };
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    client_reference_id: opts.workspaceId,
    line_items: [{ price, quantity: 1 }],
    success_url: `${env.APP_URL}/billing?checkout=success`,
    cancel_url: `${env.APP_URL}/billing?checkout=cancelled`,
    metadata,
    subscription_data: { metadata },
  });
  return { id: session.id, url: session.url };
}

export async function createPortalSession(workspaceId: string) {
  const stripe = getStripe();
  const sub = await prisma.subscription.findUnique({ where: { workspaceId } });
  if (!sub?.stripeCustomerId) throw badRequest('No billing account yet - upgrade a plan first');
  const session = await stripe.billingPortal.sessions.create({
    customer: sub.stripeCustomerId,
    return_url: `${env.APP_URL}/billing`,
  });
  return { url: session.url };
}

/** Verifies the Stripe signature on the raw body and returns the parsed event. */
export function constructStripeEvent(rawBody: Buffer, signature: string | undefined): Stripe.Event {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    throw new AppError(503, 'BILLING_NOT_CONFIGURED', 'STRIPE_WEBHOOK_SECRET is not set');
  }
  if (!signature) throw badRequest('Missing Stripe-Signature header');
  const stripe = getStripe();
  try {
    return stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch {
    throw badRequest('Invalid Stripe signature');
  }
}

function periodEnd(sub: Stripe.Subscription): Date | null {
  const loose = sub as unknown as {
    current_period_end?: number;
    items?: { data?: { current_period_end?: number }[] };
  };
  const ts = loose.current_period_end ?? loose.items?.data?.[0]?.current_period_end;
  return ts ? new Date(ts * 1000) : null;
}

const idOf = (v: string | { id: string } | null | undefined): string | undefined =>
  typeof v === 'string' ? v : v?.id;

/** Applies a verified Stripe event to the local Subscription row. Returns false for ignored events. */
export async function handleStripeEvent(event: Stripe.Event): Promise<boolean> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const workspaceId = session.metadata?.workspaceId ?? session.client_reference_id;
      const plan = parsePlan(session.metadata?.plan);
      if (!workspaceId || !plan) return false;
      const data = {
        plan,
        status: 'active',
        stripeCustomerId: idOf(session.customer as string | { id: string } | null),
        stripeSubscriptionId: idOf(session.subscription as string | { id: string } | null),
      };
      await prisma.subscription.upsert({
        where: { workspaceId },
        create: { workspaceId, ...data },
        update: data,
      });
      await recordAudit({
        workspaceId,
        action: 'billing.plan_activated',
        entity: 'subscription',
        entityId: workspaceId,
        meta: { after: { plan } },
      });
      return true;
    }
    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription;
      const plan = parsePlan(sub.metadata?.plan) ?? planFromPriceId(sub.items?.data?.[0]?.price?.id);
      const data = {
        status: sub.status,
        currentPeriodEnd: periodEnd(sub),
        ...(plan ? { plan } : {}),
      };
      const result = await prisma.subscription.updateMany({ where: { stripeSubscriptionId: sub.id }, data });
      if (result.count === 0 && sub.metadata?.workspaceId) {
        await prisma.subscription.updateMany({ where: { workspaceId: sub.metadata.workspaceId }, data });
      }
      const workspaceId = sub.metadata?.workspaceId;
      if (workspaceId) {
        await recordAudit({
          workspaceId,
          action: 'billing.subscription_updated',
          entity: 'subscription',
          entityId: sub.id,
          meta: { after: data },
        });
      }
      return true;
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      await prisma.subscription.updateMany({
        where: { stripeSubscriptionId: sub.id },
        data: { plan: 'FREE', status: 'canceled', currentPeriodEnd: null },
      });
      const workspaceId = sub.metadata?.workspaceId;
      if (workspaceId) {
        await recordAudit({
          workspaceId,
          action: 'billing.subscription_canceled',
          entity: 'subscription',
          entityId: sub.id,
          meta: { after: { plan: 'FREE' } },
        });
      }
      return true;
    }
    default:
      return false;
  }
}
