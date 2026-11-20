import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { asyncHandler } from '../lib/asyncHandler';
import { HttpError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { authenticate, currentUser, optionalAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { isCourseManager } from '../services/access';
import { calculateProgress } from '../services/progress';
import { validateForPublish } from '../services/publish';
import { slugify } from '../lib/slug';

export const coursesRouter = Router();

const courseFields = {
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(1).max(5000),
  priceCents: z.number().int().min(0).max(1_000_000),
  category: z.string().trim().min(1).max(60),
  thumbnail: z.string().url().max(500).nullable().optional(),
};
const createCourseSchema = z.object({ ...courseFields, priceCents: courseFields.priceCents.default(0), category: courseFields.category.default('General') });
const updateCourseSchema = z.object(courseFields).partial();
const idParam = z.object({ id: z.string().min(1) });

const catalogQuery = z.object({
  q: z.string().trim().optional(),
  category: z.string().trim().optional(),
  minPrice: z.coerce.number().int().min(0).optional(),
  maxPrice: z.coerce.number().int().min(0).optional(),
  free: z.enum(['true', 'false']).optional(),
  sort: z.enum(['newest', 'price_asc', 'price_desc']).default('newest'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(12),
});

async function uniqueSlug(title: string): Promise<string> {
  const base = slugify(title) || 'course';
  let slug = base;
  for (let i = 1; await prisma.course.findUnique({ where: { slug }, select: { id: true } }); i++) {
    slug = `${base}-${Math.random().toString(36).slice(2, 6)}${i > 3 ? i : ''}`;
  }
  return slug;
}

async function getCourseOrThrow(id: string) {
  const course = await prisma.course.findUnique({ where: { id } });
  if (!course) throw HttpError.notFound('Course not found');
  return course;
}

async function getManagedCourse(id: string, user: { id: string; role: 'STUDENT' | 'INSTRUCTOR' | 'ADMIN' }) {
  const course = await getCourseOrThrow(id);
  if (!isCourseManager(user, course)) throw HttpError.forbidden('You do not own this course');
  return course;
}

// ---- public catalog -------------------------------------------------------
coursesRouter.get(
  '/courses',
  validate({ query: catalogQuery }),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof catalogQuery>;
    const where: Prisma.CourseWhereInput = { status: 'PUBLISHED' };
    if (q.q) where.OR = [{ title: { contains: q.q, mode: 'insensitive' } }, { description: { contains: q.q, mode: 'insensitive' } }];
    if (q.category) where.category = { equals: q.category, mode: 'insensitive' };
    const price: Prisma.IntFilter = {};
    if (q.free === 'true') price.equals = 0;
    if (q.free === 'false') price.gt = 0;
    if (q.minPrice !== undefined) price.gte = q.minPrice;
    if (q.maxPrice !== undefined) price.lte = q.maxPrice;
    if (Object.keys(price).length) where.priceCents = price;

    const orderBy: Prisma.CourseOrderByWithRelationInput =
      q.sort === 'price_asc' ? { priceCents: 'asc' } : q.sort === 'price_desc' ? { priceCents: 'desc' } : { createdAt: 'desc' };

    const [total, items] = await Promise.all([
      prisma.course.count({ where }),
      prisma.course.findMany({
        where,
        orderBy,
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { instructor: { select: { id: true, name: true } }, _count: { select: { lessons: true, enrollments: true } } },
      }),
    ]);
    res.json({ items, total, page: q.page, pageSize: q.pageSize, totalPages: Math.ceil(total / q.pageSize) });
  }),
);

coursesRouter.get(
  '/courses/categories',
  asyncHandler(async (_req, res) => {
    const rows = await prisma.course.groupBy({ by: ['category'], where: { status: 'PUBLISHED' }, _count: { _all: true } });
    res.json({ items: rows.map((r) => ({ category: r.category, count: r._count._all })) });
  }),
);

coursesRouter.get(
  '/courses/:idOrSlug',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const key = req.params.idOrSlug;
    const course = await prisma.course.findFirst({
      where: { OR: [{ id: key }, { slug: key }] },
      include: {
        instructor: { select: { id: true, name: true } },
        sections: {
          orderBy: { position: 'asc' },
          include: {
            lessons: {
              orderBy: { position: 'asc' },
              select: { id: true, title: true, position: true, type: true, durationSec: true, videoStatus: true },
            },
          },
        },
        quizzes: { select: { id: true, title: true, lessonId: true, required: true, passMarkPct: true, maxAttempts: true } },
      },
    });
    const user = req.user;
    const manager = Boolean(user && isCourseManager(user, course ?? { instructorId: '' }));
    if (!course || (course.status !== 'PUBLISHED' && !manager)) throw HttpError.notFound('Course not found');

    const enrollment = user
      ? await prisma.enrollment.findUnique({ where: { userId_courseId: { userId: user.id, courseId: course.id } } })
      : null;
    res.json({ ...course, enrolled: Boolean(enrollment), canManage: manager });
  }),
);

// ---- instructor / admin management ---------------------------------------
coursesRouter.get(
  '/instructor/courses',
  authenticate,
  requireRole('INSTRUCTOR', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const items = await prisma.course.findMany({
      where: user.role === 'ADMIN' ? {} : { instructorId: user.id },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { lessons: true, enrollments: true } } },
    });
    res.json({ items });
  }),
);

coursesRouter.get(
  '/admin/courses',
  authenticate,
  requireRole('ADMIN'),
  asyncHandler(async (_req, res) => {
    const items = await prisma.course.findMany({
      orderBy: { createdAt: 'desc' },
      include: { instructor: { select: { id: true, name: true } }, _count: { select: { lessons: true, enrollments: true } } },
    });
    res.json({ items });
  }),
);

coursesRouter.post(
  '/courses',
  authenticate,
  requireRole('INSTRUCTOR', 'ADMIN'),
  validate({ body: createCourseSchema }),
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const body = req.body as z.infer<typeof createCourseSchema>;
    const course = await prisma.course.create({
      data: { ...body, thumbnail: body.thumbnail ?? null, slug: await uniqueSlug(body.title), instructorId: user.id },
    });
    res.status(201).json(course);
  }),
);

coursesRouter.patch(
  '/courses/:id',
  authenticate,
  requireRole('INSTRUCTOR', 'ADMIN'),
  validate({ params: idParam, body: updateCourseSchema }),
  asyncHandler(async (req, res) => {
    await getManagedCourse(req.params.id, currentUser(req));
    res.json(await prisma.course.update({ where: { id: req.params.id }, data: req.body }));
  }),
);

coursesRouter.delete(
  '/courses/:id',
  authenticate,
  requireRole('INSTRUCTOR', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const course = await getManagedCourse(req.params.id, currentUser(req));
    if (course.status === 'PUBLISHED' && (await prisma.enrollment.count({ where: { courseId: course.id } })) > 0) {
      throw HttpError.conflict('Cannot delete a published course that has enrollments; unpublish it instead');
    }
    await prisma.course.delete({ where: { id: course.id } });
    res.status(204).end();
  }),
);

coursesRouter.post(
  '/courses/:id/publish',
  authenticate,
  requireRole('INSTRUCTOR', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const course = await getManagedCourse(req.params.id, currentUser(req));
    const full = await prisma.course.findUnique({
      where: { id: course.id },
      include: { sections: { include: { lessons: true } } },
    });
    const problems = validateForPublish(full!);
    if (problems.length) throw HttpError.badRequest('Course is not ready to publish', { problems });
    res.json(await prisma.course.update({ where: { id: course.id }, data: { status: 'PUBLISHED' } }));
  }),
);

coursesRouter.post(
  '/courses/:id/unpublish',
  authenticate,
  requireRole('INSTRUCTOR', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const course = await getManagedCourse(req.params.id, currentUser(req));
    res.json(await prisma.course.update({ where: { id: course.id }, data: { status: 'DRAFT' } }));
  }),
);

// ---- sections --------------------------------------------------------------
const sectionSchema = z.object({ title: z.string().trim().min(1).max(120), position: z.number().int().min(0).optional() });

coursesRouter.post(
  '/courses/:id/sections',
  authenticate,
  requireRole('INSTRUCTOR', 'ADMIN'),
  validate({ body: sectionSchema }),
  asyncHandler(async (req, res) => {
    const course = await getManagedCourse(req.params.id, currentUser(req));
    const last = await prisma.section.aggregate({ where: { courseId: course.id }, _max: { position: true } });
    const section = await prisma.section.create({
      data: { courseId: course.id, title: req.body.title, position: req.body.position ?? (last._max.position ?? -1) + 1 },
    });
    res.status(201).json(section);
  }),
);

coursesRouter.patch(
  '/sections/:id',
  authenticate,
  requireRole('INSTRUCTOR', 'ADMIN'),
  validate({ body: sectionSchema.partial() }),
  asyncHandler(async (req, res) => {
    const section = await prisma.section.findUnique({ where: { id: req.params.id }, include: { course: true } });
    if (!section) throw HttpError.notFound('Section not found');
    if (!isCourseManager(currentUser(req), section.course)) throw HttpError.forbidden('You do not own this course');
    res.json(await prisma.section.update({ where: { id: section.id }, data: req.body }));
  }),
);

coursesRouter.delete(
  '/sections/:id',
  authenticate,
  requireRole('INSTRUCTOR', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const section = await prisma.section.findUnique({ where: { id: req.params.id }, include: { course: true } });
    if (!section) throw HttpError.notFound('Section not found');
    if (!isCourseManager(currentUser(req), section.course)) throw HttpError.forbidden('You do not own this course');
    await prisma.section.delete({ where: { id: section.id } });
    res.status(204).end();
  }),
);

// ---- enrollment & progress -------------------------------------------------
coursesRouter.post(
  '/courses/:id/enroll',
  authenticate,
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const course = await getCourseOrThrow(req.params.id);
    if (course.status !== 'PUBLISHED') throw HttpError.notFound('Course not found');
    if (course.priceCents > 0) {
      const paid = await prisma.payment.findFirst({
        where: { userId: user.id, courseId: course.id, status: 'COMPLETED' },
        select: { id: true },
      });
      if (!paid) {
        return res.status(402).json({ error: 'Payment required', checkoutEndpoint: '/payments/checkout', courseId: course.id });
      }
    }
    const enrollment = await prisma.enrollment.upsert({
      where: { userId_courseId: { userId: user.id, courseId: course.id } },
      update: {},
      create: { userId: user.id, courseId: course.id },
    });
    res.status(201).json(enrollment);
  }),
);

coursesRouter.get(
  '/courses/:id/progress',
  authenticate,
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    res.json(await courseProgressFor(user.id, req.params.id));
  }),
);

export async function courseProgressFor(userId: string, courseId: string) {
  const [lessons, progress] = await Promise.all([
    prisma.lesson.findMany({
      where: { courseId },
      select: { id: true, section: { select: { position: true } }, position: true },
    }),
    prisma.lessonProgress.findMany({ where: { userId, courseId }, orderBy: { updatedAt: 'desc' } }),
  ]);
  const ordered = [...lessons].sort((a, b) => a.section.position - b.section.position || a.position - b.position).map((l) => l.id);
  const result = calculateProgress({
    lessonIds: ordered,
    completedLessonIds: progress.filter((p) => p.completed).map((p) => p.lessonId),
    lastViewedLessonId: progress[0]?.lessonId,
  });
  return { ...result, lessons: progress.map((p) => ({ lessonId: p.lessonId, completed: p.completed, positionSec: p.positionSec })) };
}

coursesRouter.get(
  '/me/enrollments',
  authenticate,
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const enrollments = await prisma.enrollment.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      include: {
        course: { select: { id: true, title: true, slug: true, thumbnail: true, category: true, instructor: { select: { name: true } } } },
      },
    });
    const items = await Promise.all(
      enrollments.map(async (e) => {
        const { lessons: _lessons, ...progress } = await courseProgressFor(user.id, e.courseId);
        return { ...e, progress };
      }),
    );
    res.json({ items });
  }),
);
