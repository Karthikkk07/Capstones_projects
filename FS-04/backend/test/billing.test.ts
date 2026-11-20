import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type Stripe from 'stripe';
import { env } from '../src/config/env';
import { setStripeClient } from '../src/lib/stripe';
import { app, authAs } from './helpers/app';
import { prismaMock } from './helpers/prismaMock';

const asStripe = (partial: unknown) => partial as unknown as Stripe;

function stripeWithEvent(event: unknown | Error) {
  const constructEvent = vi.fn(() => {
    if (event instanceof Error) throw event;
    return event;
  });
  setStripeClient(asStripe({ webhooks: { constructEvent } }));
  return constructEvent;
}

const postWebhook = (event: object = {}) =>
  request(app)
    .post('/api/billing/webhook')
    .set('Content-Type', 'application/json')
    .set('Stripe-Signature', 't=1,v1=abc')
    .send(JSON.stringify(event));

describe('Stripe webhook endpoint', () => {
  beforeEach(() => {
    env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
  });
  afterEach(() => {
    setStripeClient(null);
    env.STRIPE_WEBHOOK_SECRET = undefined;
    env.STRIPE_SECRET_KEY = undefined;
    env.STRIPE_PRICE_PRO = undefined;
  });

  it('verifies the signature against the raw body with the webhook secret', async () => {
    const constructEvent = stripeWithEvent({ type: 'invoice.paid', data: { object: {} } });
    const res = await postWebhook({ any: 'thing' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true, handled: false });
    const [raw, sig, secret] = constructEvent.mock.calls[0] as unknown as [Buffer, string, string];
    expect(Buffer.isBuffer(raw)).toBe(true);
    expect(raw.toString()).toBe('{"any":"thing"}');
    expect(sig).toBe('t=1,v1=abc');
    expect(secret).toBe('whsec_test');
  });

  it('rejects events with an invalid signature (400) and changes nothing', async () => {
    stripeWithEvent(new Error('bad signature'));
    const res = await postWebhook();
    expect(res.status).toBe(400);
    expect(prismaMock.subscription.upsert).not.toHaveBeenCalled();
  });

  it('rejects requests without a Stripe-Signature header', async () => {
    stripeWithEvent({ type: 'x' });
    const res = await request(app).post('/api/billing/webhook').set('Content-Type', 'application/json').send('{}');
    expect(res.status).toBe(400);
  });

  it('answers 503 when STRIPE_WEBHOOK_SECRET is not configured', async () => {
    env.STRIPE_WEBHOOK_SECRET = undefined;
    expect((await postWebhook()).status).toBe(503);
  });

  it('checkout.session.completed activates the purchased plan for the workspace from our metadata', async () => {
    stripeWithEvent({
      type: 'checkout.session.completed',
      data: {
        object: {
          customer: 'cus_1',
          subscription: 'sub_1',
          client_reference_id: 'wsA',
          metadata: { workspaceId: 'wsA', plan: 'PRO' },
        },
      },
    });
    const res = await postWebhook();

    expect(res.body.handled).toBe(true);
    expect(prismaMock.subscription.upsert).toHaveBeenCalledWith({
      where: { workspaceId: 'wsA' },
      create: { workspaceId: 'wsA', plan: 'PRO', status: 'active', stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1' },
      update: { plan: 'PRO', status: 'active', stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1' },
    });
    expect(prismaMock.auditLog.create.mock.calls[0][0].data.action).toBe('billing.plan_activated');
  });

  it('ignores checkout sessions that carry no workspace metadata', async () => {
    stripeWithEvent({ type: 'checkout.session.completed', data: { object: { metadata: {} } } });
    const res = await postWebhook();
    expect(res.body.handled).toBe(false);
    expect(prismaMock.subscription.upsert).not.toHaveBeenCalled();
  });

  it('customer.subscription.updated syncs status and period end', async () => {
    prismaMock.subscription.updateMany.mockResolvedValue({ count: 1 });
    stripeWithEvent({
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_1', status: 'past_due', current_period_end: 1_900_000_000, metadata: { plan: 'BUSINESS', workspaceId: 'wsA' } } },
    });
    await postWebhook();

    const call = prismaMock.subscription.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ stripeSubscriptionId: 'sub_1' });
    expect(call.data).toMatchObject({ status: 'past_due', plan: 'BUSINESS' });
    expect(call.data.currentPeriodEnd).toEqual(new Date(1_900_000_000 * 1000));
  });

  it('customer.subscription.deleted downgrades the workspace to FREE', async () => {
    stripeWithEvent({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', metadata: { workspaceId: 'wsA' } } } });
    await postWebhook();
    expect(prismaMock.subscription.updateMany).toHaveBeenCalledWith({
      where: { stripeSubscriptionId: 'sub_1' },
      data: { plan: 'FREE', status: 'canceled', currentPeriodEnd: null },
    });
  });
});

describe('billing endpoints', () => {
  afterEach(() => {
    setStripeClient(null);
    env.STRIPE_SECRET_KEY = undefined;
    env.STRIPE_PRICE_PRO = undefined;
  });

  it('returns the current plan with usage vs limits', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue({ plan: 'PRO', status: 'active', stripeCustomerId: 'cus_1', currentPeriodEnd: null });
    prismaMock.project.count.mockResolvedValue(4);
    prismaMock.membership.count.mockResolvedValue(7);

    const res = await request(app).get('/api/billing').set(authAs('ADMIN'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      plan: 'PRO',
      limits: { projects: 10, members: 25 },
      usage: { projects: 4, members: 7 },
      hasBillingAccount: true,
    });
  });

  it('only the OWNER may start a checkout', async () => {
    const res = await request(app).post('/api/billing/checkout').set(authAs('ADMIN')).send({ plan: 'PRO' });
    expect(res.status).toBe(403);
  });

  it('fails gracefully with 503 when STRIPE_SECRET_KEY is not set', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ email: 'o@acme.test' });
    const res = await request(app).post('/api/billing/checkout').set(authAs('OWNER')).send({ plan: 'PRO' });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('BILLING_NOT_CONFIGURED');
  });

  it('rejects an unknown plan', async () => {
    const res = await request(app).post('/api/billing/checkout').set(authAs('OWNER')).send({ plan: 'FREE' });
    expect(res.status).toBe(400);
  });

  it('creates a Checkout Session whose metadata carries the workspace from the JWT', async () => {
    env.STRIPE_PRICE_PRO = 'price_pro';
    const create = vi.fn().mockResolvedValue({ id: 'cs_1', url: 'https://checkout.stripe.test/cs_1' });
    const customers = { create: vi.fn().mockResolvedValue({ id: 'cus_new' }) };
    setStripeClient(asStripe({ customers, checkout: { sessions: { create } } }));
    prismaMock.user.findUnique.mockResolvedValue({ email: 'o@acme.test' });
    prismaMock.subscription.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/billing/checkout')
      .set(authAs('OWNER', { workspaceId: 'wsA' }))
      .send({ plan: 'PRO', workspaceId: 'wsB' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 'cs_1', url: 'https://checkout.stripe.test/cs_1' });
    expect(customers.create).toHaveBeenCalledWith({ email: 'o@acme.test', metadata: { workspaceId: 'wsA' } });
    expect(create.mock.calls[0][0]).toMatchObject({
      mode: 'subscription',
      customer: 'cus_new',
      client_reference_id: 'wsA',
      line_items: [{ price: 'price_pro', quantity: 1 }],
      metadata: { workspaceId: 'wsA', plan: 'PRO' },
    });
  });
});
