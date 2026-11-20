import type Stripe from 'stripe';
import type { PrismaClient } from '@prisma/client';
import { splitRevenue } from './revenue';

export type WebhookOutcome = 'enrolled' | 'duplicate' | 'ignored' | 'invalid';

type Tx = Pick<PrismaClient, 'course' | 'payment' | 'enrollment'>;
type Db = Pick<PrismaClient, '$transaction'>;

/** Applies a verified Stripe event. Idempotent on the checkout session id. */
export async function handleStripeEvent(event: Stripe.Event, db: Db, instructorSharePct: number): Promise<WebhookOutcome> {
  if (event.type !== 'checkout.session.completed') return 'ignored';

  const session = event.data.object as Stripe.Checkout.Session;
  const { courseId, userId } = session.metadata ?? {};
  if (!courseId || !userId || session.payment_status === 'unpaid') return 'invalid';

  return db.$transaction(async (tx) => {
    const t = tx as unknown as Tx;
    if (await t.payment.findUnique({ where: { stripeSessionId: session.id }, select: { id: true } })) return 'duplicate';

    const course = await t.course.findUnique({ where: { id: courseId }, select: { id: true, instructorId: true } });
    if (!course) return 'invalid';

    const split = splitRevenue(session.amount_total ?? 0, instructorSharePct);
    await t.payment.create({
      data: {
        userId,
        courseId,
        instructorId: course.instructorId,
        stripeSessionId: session.id,
        stripePaymentIntent: typeof session.payment_intent === 'string' ? session.payment_intent : null,
        amountCents: split.amountCents,
        instructorShareCents: split.instructorShareCents,
        platformFeeCents: split.platformFeeCents,
        currency: session.currency ?? 'usd',
        status: 'COMPLETED',
      },
    });
    await t.enrollment.upsert({
      where: { userId_courseId: { userId, courseId } },
      update: {},
      create: { userId, courseId },
    });
    return 'enrolled' as const;
  });
}
