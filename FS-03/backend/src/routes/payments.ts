import express, { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env';
import { asyncHandler } from '../lib/asyncHandler';
import { HttpError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { authenticate, currentUser } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { handleStripeEvent } from '../services/payments';
import { getStripe } from '../services/stripeClient';

export const paymentsRouter = Router();
/** Must be mounted BEFORE express.json() because Stripe signature verification needs the raw body. */
export const stripeWebhookRouter = Router();

paymentsRouter.post(
  '/payments/checkout',
  authenticate,
  validate({ body: z.object({ courseId: z.string().min(1) }) }),
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const stripe = getStripe();
    const course = await prisma.course.findUnique({ where: { id: req.body.courseId } });
    if (!course || course.status !== 'PUBLISHED') throw HttpError.notFound('Course not found');
    if (course.priceCents <= 0) throw HttpError.badRequest('This course is free - enroll directly');
    const existing = await prisma.enrollment.findUnique({ where: { userId_courseId: { userId: user.id, courseId: course.id } } });
    if (existing) throw HttpError.conflict('Already enrolled in this course');

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      client_reference_id: user.id,
      metadata: { courseId: course.id, userId: user.id },
      line_items: [
        {
          quantity: 1,
          price_data: { currency: 'usd', unit_amount: course.priceCents, product_data: { name: course.title } },
        },
      ],
      success_url: `${env.FRONTEND_URL}/courses/${course.slug}?payment=success`,
      cancel_url: `${env.FRONTEND_URL}/courses/${course.slug}?payment=cancelled`,
    });
    res.status(201).json({ sessionId: session.id, url: session.url });
  }),
);

stripeWebhookRouter.post(
  '/payments/webhook',
  express.raw({ type: 'application/json' }),
  asyncHandler(async (req, res) => {
    const signature = req.headers['stripe-signature'];
    if (!env.STRIPE_WEBHOOK_SECRET) throw HttpError.unavailable('Webhook secret not configured (STRIPE_WEBHOOK_SECRET missing)');
    if (typeof signature !== 'string') throw HttpError.badRequest('Missing stripe-signature header');
    const stripe = getStripe();

    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body as Buffer, signature, env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      throw HttpError.badRequest(`Webhook signature verification failed: ${(err as Error).message}`);
    }
    const outcome = await handleStripeEvent(event, prisma, env.INSTRUCTOR_SHARE_PCT);
    res.json({ received: true, outcome });
  }),
);
