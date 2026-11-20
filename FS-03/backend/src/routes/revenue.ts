import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler';
import { HttpError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { authenticate, currentUser, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { buildRevenueSummary } from '../services/revenue';

export const revenueRouter = Router();

revenueRouter.get(
  '/instructor/revenue/summary',
  authenticate,
  requireRole('INSTRUCTOR', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const payments = await prisma.payment.findMany({
      where: { instructorId: currentUser(req).id, status: 'COMPLETED' },
      select: { courseId: true, instructorShareCents: true, createdAt: true, course: { select: { title: true } } },
    });
    res.json(
      buildRevenueSummary(
        payments.map((p) => ({
          courseId: p.courseId,
          courseTitle: p.course.title,
          instructorShareCents: p.instructorShareCents,
          createdAt: p.createdAt,
        })),
      ),
    );
  }),
);

revenueRouter.get(
  '/instructor/payouts',
  authenticate,
  requireRole('INSTRUCTOR', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const instructorId = currentUser(req).id;
    const [payouts, pending] = await Promise.all([
      prisma.payout.findMany({ where: { instructorId }, orderBy: { createdAt: 'desc' } }),
      prisma.payment.aggregate({
        where: { instructorId, status: 'COMPLETED', payoutId: null },
        _sum: { instructorShareCents: true },
      }),
    ]);
    res.json({ items: payouts, pendingBalanceCents: pending._sum.instructorShareCents ?? 0 });
  }),
);

/** Simple ledger settlement: bundles all unpaid completed payments of an instructor into one PAID payout. */
revenueRouter.post(
  '/admin/payouts',
  authenticate,
  requireRole('ADMIN'),
  validate({ body: z.object({ instructorId: z.string().min(1) }) }),
  asyncHandler(async (req, res) => {
    const { instructorId } = req.body as { instructorId: string };
    const payout = await prisma.$transaction(async (tx) => {
      const unpaid = await tx.payment.findMany({
        where: { instructorId, status: 'COMPLETED', payoutId: null },
        select: { id: true, instructorShareCents: true },
      });
      if (unpaid.length === 0) throw HttpError.conflict('Nothing to pay out');
      const amountCents = unpaid.reduce((sum, p) => sum + p.instructorShareCents, 0);
      const created = await tx.payout.create({ data: { instructorId, amountCents, status: 'PAID', paidAt: new Date() } });
      await tx.payment.updateMany({ where: { id: { in: unpaid.map((p) => p.id) } }, data: { payoutId: created.id } });
      return created;
    });
    res.status(201).json(payout);
  }),
);
