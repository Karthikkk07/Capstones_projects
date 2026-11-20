import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { deliveryConfigFromEnv } from '../config/delivery';
import { env } from '../config/env';
import { asyncHandler } from '../lib/asyncHandler';
import { HttpError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { videoUpload } from '../lib/upload';
import { authenticate, currentUser, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { canAccessCourse, isCourseManager, isEnrolled } from '../services/access';
import { issueCertificateIfEligible } from '../services/certificates';
import { buildPlaybackInfo } from '../services/cloudfront';
import { enqueueTranscode } from '../services/queue';
import { courseProgressFor } from './courses';

export const lessonsRouter = Router();

const lessonFields = {
  title: z.string().trim().min(1).max(160),
  type: z.enum(['VIDEO', 'TEXT']),
  content: z.string().max(50_000).nullable().optional(),
  position: z.number().int().min(0).optional(),
};
const createLessonSchema = z.object({ ...lessonFields, type: lessonFields.type.default('VIDEO') });
const updateLessonSchema = z.object(lessonFields).partial();
const progressSchema = z.object({
  positionSec: z.number().int().min(0).max(86_400).optional(),
  completed: z.boolean().optional(),
});

async function loadLesson(id: string) {
  const lesson = await prisma.lesson.findUnique({ where: { id }, include: { course: true } });
  if (!lesson) throw HttpError.notFound('Lesson not found');
  return lesson;
}

async function loadManagedLesson(req: Request) {
  const lesson = await loadLesson(req.params.id);
  if (!isCourseManager(currentUser(req), lesson.course)) throw HttpError.forbidden('You do not own this course');
  return lesson;
}

const publicLesson = <T extends { sourcePath?: unknown; course?: unknown }>(lesson: T) => {
  const { sourcePath: _s, course: _c, ...rest } = lesson;
  return rest;
};

lessonsRouter.post(
  '/sections/:id/lessons',
  authenticate,
  requireRole('INSTRUCTOR', 'ADMIN'),
  validate({ body: createLessonSchema }),
  asyncHandler(async (req, res) => {
    const section = await prisma.section.findUnique({ where: { id: req.params.id }, include: { course: true } });
    if (!section) throw HttpError.notFound('Section not found');
    if (!isCourseManager(currentUser(req), section.course)) throw HttpError.forbidden('You do not own this course');
    const last = await prisma.lesson.aggregate({ where: { sectionId: section.id }, _max: { position: true } });
    const lesson = await prisma.lesson.create({
      data: {
        ...req.body,
        courseId: section.courseId,
        sectionId: section.id,
        position: req.body.position ?? (last._max.position ?? -1) + 1,
        videoStatus: req.body.type === 'TEXT' ? 'READY' : 'PENDING',
      },
    });
    res.status(201).json(publicLesson(lesson));
  }),
);

lessonsRouter.patch(
  '/lessons/:id',
  authenticate,
  requireRole('INSTRUCTOR', 'ADMIN'),
  validate({ body: updateLessonSchema }),
  asyncHandler(async (req, res) => {
    const lesson = await loadManagedLesson(req);
    res.json(publicLesson(await prisma.lesson.update({ where: { id: lesson.id }, data: req.body })));
  }),
);

lessonsRouter.delete(
  '/lessons/:id',
  authenticate,
  requireRole('INSTRUCTOR', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const lesson = await loadManagedLesson(req);
    await prisma.lesson.delete({ where: { id: lesson.id } });
    res.status(204).end();
  }),
);

lessonsRouter.get(
  '/lessons/:id',
  authenticate,
  asyncHandler(async (req, res) => {
    const lesson = await loadLesson(req.params.id);
    if (!(await canAccessCourse(currentUser(req), lesson.course))) throw HttpError.forbidden('Enroll in this course to view the lesson');
    const progress = await prisma.lessonProgress.findUnique({
      where: { userId_lessonId: { userId: currentUser(req).id, lessonId: lesson.id } },
    });
    res.json({ ...publicLesson(lesson), progress });
  }),
);

// ---- video upload -> BullMQ ----------------------------------------------
const authoriseUpload = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const lesson = await loadManagedLesson(req);
  if (lesson.type !== 'VIDEO') throw HttpError.badRequest('Only VIDEO lessons accept uploads');
  res.locals.lesson = lesson;
  next();
});

lessonsRouter.post(
  '/lessons/:id/video',
  authenticate,
  requireRole('INSTRUCTOR', 'ADMIN'),
  authoriseUpload,
  (req, res, next) => videoUpload().single('video')(req, res, next),
  asyncHandler(async (req, res) => {
    if (!req.file) throw HttpError.badRequest('Attach the video as multipart field "video"');
    const lessonId = (res.locals.lesson as { id: string }).id;
    const sourcePath = req.file.path;
    await prisma.lesson.update({
      where: { id: lessonId },
      data: { sourcePath, videoStatus: 'PENDING', hlsPath: null, durationSec: null },
    });
    try {
      const jobId = await enqueueTranscode({ lessonId, sourcePath });
      res.status(202).json({ lessonId, videoStatus: 'PENDING', jobId });
    } catch (err) {
      await prisma.lesson.update({ where: { id: lessonId }, data: { videoStatus: 'FAILED' } });
      console.error('[queue] failed to enqueue transcode', err);
      throw HttpError.unavailable('Video processing queue is unavailable, please retry');
    }
  }),
);

lessonsRouter.get(
  '/lessons/:id/video-status',
  authenticate,
  requireRole('INSTRUCTOR', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const lesson = await loadManagedLesson(req);
    res.json({ lessonId: lesson.id, videoStatus: lesson.videoStatus, hlsPath: lesson.hlsPath, durationSec: lesson.durationSec });
  }),
);

// ---- playback (enrolled users, owner and admin only) ----------------------
lessonsRouter.get(
  '/lessons/:id/playback',
  authenticate,
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const lesson = await loadLesson(req.params.id);
    if (!(await canAccessCourse(user, lesson.course))) throw HttpError.forbidden('Enroll in this course to watch this lesson');
    if (lesson.type !== 'VIDEO') throw HttpError.badRequest('Lesson has no video');
    if (lesson.videoStatus !== 'READY' || !lesson.hlsPath) {
      return res.status(409).json({ error: 'Video is not ready yet', videoStatus: lesson.videoStatus });
    }
    const info = buildPlaybackInfo(lesson.hlsPath, deliveryConfigFromEnv());
    if (info.cookies && env.CLOUDFRONT_COOKIE_DOMAIN) {
      for (const [name, value] of Object.entries(info.cookies)) {
        res.cookie(name, value, { domain: env.CLOUDFRONT_COOKIE_DOMAIN, secure: true, httpOnly: true, sameSite: 'none', path: '/' });
      }
    }
    res.json({ lessonId: lesson.id, ...info });
  }),
);

// ---- progress ---------------------------------------------------------------
lessonsRouter.post(
  '/lessons/:id/progress',
  authenticate,
  validate({ body: progressSchema }),
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const lesson = await loadLesson(req.params.id);
    if (!(await isEnrolled(user.id, lesson.courseId))) throw HttpError.forbidden('You are not enrolled in this course');
    const { positionSec, completed } = req.body as z.infer<typeof progressSchema>;

    const existing = await prisma.lessonProgress.findUnique({
      where: { userId_lessonId: { userId: user.id, lessonId: lesson.id } },
    });
    const progress = await prisma.lessonProgress.upsert({
      where: { userId_lessonId: { userId: user.id, lessonId: lesson.id } },
      create: {
        userId: user.id,
        courseId: lesson.courseId,
        lessonId: lesson.id,
        positionSec: positionSec ?? 0,
        completed: completed ?? false,
        completedAt: completed ? new Date() : null,
      },
      update: {
        ...(positionSec !== undefined ? { positionSec } : {}),
        ...(completed !== undefined ? { completed, completedAt: completed ? (existing?.completedAt ?? new Date()) : null } : {}),
      },
    });

    const certificate = completed ? (await issueCertificateIfEligible(prisma, user.id, lesson.courseId)).certificate : null;
    res.json({ progress, course: await courseProgressFor(user.id, lesson.courseId), certificate });
  }),
);
