import request from 'supertest';
import type Stripe from 'stripe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authHeader, prismaMock, resetPrismaMock } from './helpers';

vi.mock('../src/lib/prisma', async () => ({ prisma: (await import('./helpers')).prismaMock }));
vi.mock('../src/services/queue', () => ({ enqueueTranscode: vi.fn() }));

import { createApp } from '../src/app';
import { setStripeClient } from '../src/services/stripeClient';

const app = createApp();

const completedEvent = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 'evt_1',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test_123',
        payment_status: 'paid',
        amount_total: 4999,
        currency: 'usd',
        payment_intent: 'pi_123',
        metadata: { courseId: 'course1', userId: 'stu1' },
        ...overrides,
      },
    },
  }) as unknown as Stripe.Event;

function fakeStripe(event: Stripe.Event | Error) {
  return {
    webhooks: {
      constructEvent: vi.fn(() => {
        if (event instanceof Error) throw event;
        return event;
      }),
    },
    checkout: { sessions: { create: vi.fn().mockResolvedValue({ id: 'cs_test_new', url: 'https://checkout.stripe.test/pay' }) } },
  } as unknown as Stripe;
}

beforeEach(() => resetPrismaMock());
afterEach(() => setStripeClient(null));

describe('POST /payments/webhook', () => {
  const post = () =>
    request(app).post('/payments/webhook').set('stripe-signature', 't=1,v1=abc').set('Content-Type', 'application/json').send('{"raw":"body"}');

  it('creates a payment with an 80/20 split and enrolls the student', async () => {
    const stripe = fakeStripe(completedEvent());
    setStripeClient(stripe);
    prismaMock.payment.findUnique.mockResolvedValue(null);
    prismaMock.course.findUnique.mockResolvedValue({ id: 'course1', instructorId: 'inst1' });

    const res = await post();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true, outcome: 'enrolled' });
    // signature is verified against the *raw* body buffer
    const [rawBody, sig] = (stripe.webhooks.constructEvent as any).mock.calls[0];
    expect(Buffer.isBuffer(rawBody)).toBe(true);
    expect(rawBody.toString()).toBe('{"raw":"body"}');
    expect(sig).toBe('t=1,v1=abc');

    expect(prismaMock.payment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'stu1',
        courseId: 'course1',
        instructorId: 'inst1',
        stripeSessionId: 'cs_test_123',
        amountCents: 4999,
        instructorShareCents: 3999,
        platformFeeCents: 1000,
        status: 'COMPLETED',
      }),
    });
    expect(prismaMock.enrollment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId_courseId: { userId: 'stu1', courseId: 'course1' } } }),
    );
  });

  it('is idempotent for a session that was already processed', async () => {
    setStripeClient(fakeStripe(completedEvent()));
    prismaMock.payment.findUnique.mockResolvedValue({ id: 'p1' });
    const res = await post();
    expect(res.body.outcome).toBe('duplicate');
    expect(prismaMock.payment.create).not.toHaveBeenCalled();
  });

  it('ignores unrelated event types and sessions without metadata', async () => {
    setStripeClient(fakeStripe({ id: 'e', type: 'charge.succeeded', data: { object: {} } } as unknown as Stripe.Event));
    expect((await post()).body.outcome).toBe('ignored');
    setStripeClient(fakeStripe(completedEvent({ metadata: {} })));
    expect((await post()).body.outcome).toBe('invalid');
    expect(prismaMock.payment.create).not.toHaveBeenCalled();
  });

  it('rejects an invalid signature with 400', async () => {
    setStripeClient(fakeStripe(new Error('No signatures found matching')));
    const res = await post();
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/signature verification failed/i);
  });

  it('rejects requests without the stripe-signature header', async () => {
    setStripeClient(fakeStripe(completedEvent()));
    const res = await request(app).post('/payments/webhook').set('Content-Type', 'application/json').send('{}');
    expect(res.status).toBe(400);
  });
});

describe('POST /payments/checkout', () => {
  const course = { id: 'course1', slug: 'paid-course', title: 'Paid', priceCents: 4999, status: 'PUBLISHED' };

  it('returns a graceful 503 when Stripe keys are not configured', async () => {
    const res = await request(app).post('/payments/checkout').set(authHeader('stu1', 'STUDENT')).send({ courseId: 'course1' });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/not configured/i);
  });

  it('creates a Checkout session for a paid course using the injected client', async () => {
    const stripe = fakeStripe(completedEvent());
    setStripeClient(stripe);
    prismaMock.course.findUnique.mockResolvedValue(course);
    prismaMock.enrollment.findUnique.mockResolvedValue(null);
    const res = await request(app).post('/payments/checkout').set(authHeader('stu1', 'STUDENT')).send({ courseId: 'course1' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ sessionId: 'cs_test_new', url: 'https://checkout.stripe.test/pay' });
    const params = (stripe.checkout.sessions.create as any).mock.calls[0][0];
    expect(params.metadata).toEqual({ courseId: 'course1', userId: 'stu1' });
    expect(params.line_items[0].price_data.unit_amount).toBe(4999);
  });

  it('refuses checkout for free courses', async () => {
    setStripeClient(fakeStripe(completedEvent()));
    prismaMock.course.findUnique.mockResolvedValue({ ...course, priceCents: 0 });
    await request(app).post('/payments/checkout').set(authHeader('stu1', 'STUDENT')).send({ courseId: 'course1' }).expect(400);
  });
});

describe('enrollment gating for paid courses', () => {
  const paid = { id: 'course1', priceCents: 999, status: 'PUBLISHED' };

  it('returns 402 until a completed payment exists', async () => {
    prismaMock.course.findUnique.mockResolvedValue(paid);
    prismaMock.payment.findFirst.mockResolvedValue(null);
    const res = await request(app).post('/courses/course1/enroll').set(authHeader('stu1', 'STUDENT'));
    expect(res.status).toBe(402);
    expect(prismaMock.enrollment.upsert).not.toHaveBeenCalled();
  });

  it('enrolls immediately in free courses', async () => {
    prismaMock.course.findUnique.mockResolvedValue({ ...paid, priceCents: 0 });
    prismaMock.enrollment.upsert.mockResolvedValue({ id: 'e1' });
    await request(app).post('/courses/course1/enroll').set(authHeader('stu1', 'STUDENT')).expect(201);
  });
});
