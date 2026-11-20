import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env';
import { asyncHandler } from '../lib/asyncHandler';
import { HttpError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { authenticate, currentUser, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { canAccessCourse, isCourseManager } from '../services/access';
import { createLiveKitToken } from '../services/livekit';
import { isLiveHost, loadLiveClassForUser } from '../services/liveAccess';

export const liveRouter = Router();

const scheduleSchema = z.object({
  title: z.string().trim().min(1).max(160),
  scheduledAt: z.coerce.date().refine((d) => d.getTime() > Date.now() - 5 * 60 * 1000, 'scheduledAt must be in the future'),
});

const historyQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.coerce.date().optional(),
});

async function loadManagedLiveClass(id: string, user: { id: string; role: 'STUDENT' | 'INSTRUCTOR' | 'ADMIN' }) {
  const liveClass = await prisma.liveClass.findUnique({ where: { id }, include: { course: true } });
  if (!liveClass) throw HttpError.notFound('Live class not found');
  if (!isCourseManager(user, liveClass.course)) throw HttpError.forbidden('You do not own this course');
  return liveClass;
}

liveRouter.post(
  '/courses/:id/live-classes',
  authenticate,
  requireRole('INSTRUCTOR', 'ADMIN'),
  validate({ body: scheduleSchema }),
  asyncHandler(async (req, res) => {
    const course = await prisma.course.findUnique({ where: { id: req.params.id } });
    if (!course) throw HttpError.notFound('Course not found');
    if (!isCourseManager(currentUser(req), course)) throw HttpError.forbidden('You do not own this course');
    const liveClass = await prisma.liveClass.create({
      data: {
        courseId: course.id,
        title: req.body.title,
        scheduledAt: req.body.scheduledAt,
        roomName: `lms-${course.id}-${Date.now().toString(36)}`,
      },
    });
    res.status(201).json(liveClass);
  }),
);

liveRouter.get(
  '/courses/:id/live-classes',
  authenticate,
  asyncHandler(async (req, res) => {
    const course = await prisma.course.findUnique({ where: { id: req.params.id } });
    if (!course) throw HttpError.notFound('Course not found');
    if (!(await canAccessCourse(currentUser(req), course))) throw HttpError.forbidden('Enroll in this course to see live classes');
    const items = await prisma.liveClass.findMany({ where: { courseId: course.id }, orderBy: { scheduledAt: 'asc' } });
    res.json({ items });
  }),
);

liveRouter.get(
  '/me/live-classes',
  authenticate,
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const where =
      user.role === 'STUDENT'
        ? { course: { enrollments: { some: { userId: user.id } } } }
        : user.role === 'INSTRUCTOR'
          ? { course: { instructorId: user.id } }
          : {};
    const items = await prisma.liveClass.findMany({
      where: { ...where, status: { in: ['SCHEDULED', 'LIVE'] } },
      orderBy: { scheduledAt: 'asc' },
      include: { course: { select: { id: true, title: true } } },
      take: 50,
    });
    res.json({ items });
  }),
);

liveRouter.get(
  '/live-classes/:id',
  authenticate,
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const liveClass = await loadLiveClassForUser(user, req.params.id);
    res.json({ ...liveClass, isHost: isLiveHost(user, liveClass.course) });
  }),
);

liveRouter.post(
  '/live-classes/:id/start',
  authenticate,
  requireRole('INSTRUCTOR', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const liveClass = await loadManagedLiveClass(req.params.id, currentUser(req));
    if (liveClass.status === 'ENDED') throw HttpError.conflict('Live class already ended');
    res.json(
      await prisma.liveClass.update({
        where: { id: liveClass.id },
        data: { status: 'LIVE', startedAt: liveClass.startedAt ?? new Date() },
      }),
    );
  }),
);

liveRouter.post(
  '/live-classes/:id/end',
  authenticate,
  requireRole('INSTRUCTOR', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const liveClass = await loadManagedLiveClass(req.params.id, currentUser(req));
    if (liveClass.status !== 'LIVE') throw HttpError.conflict('Live class is not running');
    res.json(await prisma.liveClass.update({ where: { id: liveClass.id }, data: { status: 'ENDED', endedAt: new Date() } }));
  }),
);

liveRouter.get(
  '/live-classes/:id/token',
  authenticate,
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const liveClass = await loadLiveClassForUser(user, req.params.id);
    if (liveClass.status === 'ENDED') throw HttpError.conflict('Live class has ended');
    const host = isLiveHost(user, liveClass.course);
    if (!host && liveClass.status !== 'LIVE') throw HttpError.conflict('Live class has not started yet');

    const account = await prisma.user.findUnique({ where: { id: user.id }, select: { name: true } });
    const token = await createLiveKitToken(
      { apiKey: env.LIVEKIT_API_KEY, apiSecret: env.LIVEKIT_API_SECRET, url: env.LIVEKIT_URL },
      { identity: user.id, name: account?.name ?? user.id, roomName: liveClass.roomName, isHost: host },
    );
    res.json({ token, url: env.LIVEKIT_URL, roomName: liveClass.roomName, role: host ? 'host' : 'viewer' });
  }),
);

liveRouter.get(
  '/live-classes/:id/messages',
  authenticate,
  validate({ query: historyQuery }),
  asyncHandler(async (req, res) => {
    const liveClass = await loadLiveClassForUser(currentUser(req), req.params.id);
    const q = req.query as unknown as z.infer<typeof historyQuery>;
    const rows = await prisma.chatMessage.findMany({
      where: { liveClassId: liveClass.id, ...(q.before ? { createdAt: { lt: q.before } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: q.limit,
      include: { user: { select: { id: true, name: true, role: true } } },
    });
    res.json({ items: rows.reverse() });
  }),
);
