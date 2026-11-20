import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { asyncHandler } from '../lib/asyncHandler';
import { HttpError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { authenticate, currentUser, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { canAccessCourse, isCourseManager, isEnrolled } from '../services/access';
import { issueCertificateIfEligible } from '../services/certificates';
import { attemptsRemaining, canAttempt, gradeAttempt, type GradableQuestion } from '../services/grading';

export const quizzesRouter = Router();

const TRUE_FALSE_OPTIONS = [
  { id: 'true', text: 'True' },
  { id: 'false', text: 'False' },
];

export const questionSchema = z
  .object({
    type: z.enum(['SINGLE', 'MULTIPLE', 'TRUE_FALSE']),
    prompt: z.string().trim().min(1).max(1000),
    options: z.array(z.object({ id: z.string().trim().min(1).max(40), text: z.string().trim().min(1).max(500) })).max(10).default([]),
    correct: z.array(z.string()).min(1),
    points: z.number().int().min(1).max(100).default(1),
  })
  .superRefine((q, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    if (q.type === 'TRUE_FALSE') {
      if (q.correct.length !== 1 || !['true', 'false'].includes(q.correct[0])) fail('TRUE_FALSE needs a single correct value "true" or "false"');
      return;
    }
    const ids = q.options.map((o) => o.id);
    if (ids.length < 2) fail('At least two options are required');
    if (new Set(ids).size !== ids.length) fail('Option ids must be unique');
    if (q.correct.some((c) => !ids.includes(c))) fail('Correct answers must reference existing option ids');
    if (q.type === 'SINGLE' && q.correct.length !== 1) fail('SINGLE questions need exactly one correct answer');
  })
  .transform((q) => ({ ...q, options: q.type === 'TRUE_FALSE' ? TRUE_FALSE_OPTIONS : q.options, correct: [...new Set(q.correct)] }));

const quizSchema = z.object({
  title: z.string().trim().min(1).max(160),
  lessonId: z.string().nullable().optional(),
  passMarkPct: z.number().int().min(1).max(100).default(70),
  maxAttempts: z.number().int().min(1).max(100).nullable().optional(),
  required: z.boolean().default(true),
  questions: z.array(questionSchema).min(1).max(100),
});

const attemptSchema = z.object({ answers: z.record(z.union([z.string(), z.array(z.string())])) });

const toQuestionRows = (questions: z.output<typeof questionSchema>[]) =>
  questions.map((q, position) => ({
    type: q.type,
    prompt: q.prompt,
    options: q.options as Prisma.InputJsonValue,
    correct: q.correct as Prisma.InputJsonValue,
    points: q.points,
    position,
  }));

async function loadQuiz(id: string) {
  const quiz = await prisma.quiz.findUnique({
    where: { id },
    include: { course: true, questions: { orderBy: { position: 'asc' } } },
  });
  if (!quiz) throw HttpError.notFound('Quiz not found');
  return quiz;
}

async function assertLessonInCourse(lessonId: string | null | undefined, courseId: string) {
  if (!lessonId) return;
  const lesson = await prisma.lesson.findUnique({ where: { id: lessonId }, select: { courseId: true } });
  if (!lesson || lesson.courseId !== courseId) throw HttpError.badRequest('lessonId does not belong to this course');
}

quizzesRouter.post(
  '/courses/:id/quizzes',
  authenticate,
  requireRole('INSTRUCTOR', 'ADMIN'),
  validate({ body: quizSchema }),
  asyncHandler(async (req, res) => {
    const course = await prisma.course.findUnique({ where: { id: req.params.id } });
    if (!course) throw HttpError.notFound('Course not found');
    if (!isCourseManager(currentUser(req), course)) throw HttpError.forbidden('You do not own this course');
    const body = req.body as z.infer<typeof quizSchema>;
    await assertLessonInCourse(body.lessonId, course.id);
    const quiz = await prisma.quiz.create({
      data: {
        courseId: course.id,
        title: body.title,
        lessonId: body.lessonId ?? null,
        passMarkPct: body.passMarkPct,
        maxAttempts: body.maxAttempts ?? null,
        required: body.required,
        questions: { create: toQuestionRows(body.questions) },
      },
      include: { questions: { orderBy: { position: 'asc' } } },
    });
    res.status(201).json(quiz);
  }),
);

quizzesRouter.get(
  '/courses/:id/quizzes',
  authenticate,
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const course = await prisma.course.findUnique({ where: { id: req.params.id } });
    if (!course) throw HttpError.notFound('Course not found');
    if (!(await canAccessCourse(user, course))) throw HttpError.forbidden('Enroll in this course to see its quizzes');
    const quizzes = await prisma.quiz.findMany({
      where: { courseId: course.id },
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { questions: true } }, attempts: { where: { userId: user.id }, orderBy: { createdAt: 'desc' } } },
    });
    res.json({
      items: quizzes.map(({ attempts, ...q }) => ({
        ...q,
        attemptsUsed: attempts.length,
        attemptsRemaining: attemptsRemaining(q.maxAttempts, attempts.length),
        passed: attempts.some((a) => a.passed),
        bestPercent: attempts.reduce((best, a) => Math.max(best, a.percent), 0),
      })),
    });
  }),
);

quizzesRouter.get(
  '/quizzes/:id',
  authenticate,
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const { course, questions, ...quiz } = await loadQuiz(req.params.id);
    if (!(await canAccessCourse(user, course))) throw HttpError.forbidden('Enroll in this course to take the quiz');
    const manager = isCourseManager(user, course);
    res.json({
      ...quiz,
      questions: questions.map(({ correct, ...q }) => (manager ? { ...q, correct } : q)),
    });
  }),
);

quizzesRouter.put(
  '/quizzes/:id',
  authenticate,
  requireRole('INSTRUCTOR', 'ADMIN'),
  validate({ body: quizSchema }),
  asyncHandler(async (req, res) => {
    const quiz = await loadQuiz(req.params.id);
    if (!isCourseManager(currentUser(req), quiz.course)) throw HttpError.forbidden('You do not own this course');
    const body = req.body as z.infer<typeof quizSchema>;
    await assertLessonInCourse(body.lessonId, quiz.courseId);
    const [, updated] = await prisma.$transaction([
      prisma.question.deleteMany({ where: { quizId: quiz.id } }),
      prisma.quiz.update({
        where: { id: quiz.id },
        data: {
          title: body.title,
          lessonId: body.lessonId ?? null,
          passMarkPct: body.passMarkPct,
          maxAttempts: body.maxAttempts ?? null,
          required: body.required,
          questions: { create: toQuestionRows(body.questions) },
        },
        include: { questions: { orderBy: { position: 'asc' } } },
      }),
    ]);
    res.json(updated);
  }),
);

quizzesRouter.delete(
  '/quizzes/:id',
  authenticate,
  requireRole('INSTRUCTOR', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const quiz = await loadQuiz(req.params.id);
    if (!isCourseManager(currentUser(req), quiz.course)) throw HttpError.forbidden('You do not own this course');
    await prisma.quiz.delete({ where: { id: quiz.id } });
    res.status(204).end();
  }),
);

quizzesRouter.post(
  '/quizzes/:id/attempts',
  authenticate,
  validate({ body: attemptSchema }),
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const quiz = await loadQuiz(req.params.id);
    if (!(await isEnrolled(user.id, quiz.courseId))) throw HttpError.forbidden('You are not enrolled in this course');
    if (quiz.questions.length === 0) throw HttpError.badRequest('Quiz has no questions');

    const used = await prisma.quizAttempt.count({ where: { quizId: quiz.id, userId: user.id } });
    if (!canAttempt(quiz.maxAttempts, used)) throw HttpError.forbidden('No attempts remaining for this quiz');

    const gradable: GradableQuestion[] = quiz.questions.map((q) => ({
      id: q.id,
      type: q.type,
      options: q.options as GradableQuestion['options'],
      correct: q.correct as string[],
      points: q.points,
    }));
    const { answers } = req.body as z.infer<typeof attemptSchema>;
    const grade = gradeAttempt(gradable, answers, quiz.passMarkPct);

    const attempt = await prisma.quizAttempt.create({
      data: {
        quizId: quiz.id,
        userId: user.id,
        answers: answers as Prisma.InputJsonValue,
        score: grade.score,
        maxScore: grade.maxScore,
        percent: grade.percent,
        passed: grade.passed,
      },
    });
    const certificate = grade.passed ? (await issueCertificateIfEligible(prisma, user.id, quiz.courseId)).certificate : null;
    res.status(201).json({
      attemptId: attempt.id,
      ...grade,
      passMarkPct: quiz.passMarkPct,
      attemptsRemaining: attemptsRemaining(quiz.maxAttempts, used + 1),
      certificate,
    });
  }),
);

quizzesRouter.get(
  '/quizzes/:id/attempts',
  authenticate,
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const items = await prisma.quizAttempt.findMany({
      where: { quizId: req.params.id, userId: user.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ items });
  }),
);
