import bcrypt from 'bcryptjs';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler';
import { HttpError } from '../lib/errors';
import { signToken } from '../lib/jwt';
import { prisma } from '../lib/prisma';
import { authenticate, currentUser } from '../middleware/auth';
import { validate } from '../middleware/validate';

export const authRouter = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: process.env.NODE_ENV === 'test' ? 10_000 : 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, please try again later' },
});

const registerSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(8).max(128),
  name: z.string().trim().min(1).max(100),
  role: z.enum(['STUDENT', 'INSTRUCTOR']).default('STUDENT'),
});

const loginSchema = z.object({ email: z.string().email().toLowerCase(), password: z.string().min(1) });

const publicUser = (u: { id: string; email: string; name: string; role: string }) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
});

authRouter.post(
  '/register',
  authLimiter,
  validate({ body: registerSchema }),
  asyncHandler(async (req, res) => {
    const { email, password, name, role } = req.body as z.infer<typeof registerSchema>;
    if (await prisma.user.findUnique({ where: { email } })) throw HttpError.conflict('Email already registered');
    const user = await prisma.user.create({ data: { email, name, role, passwordHash: await bcrypt.hash(password, 10) } });
    res.status(201).json({ token: signToken(user), user: publicUser(user) });
  }),
);

authRouter.post(
  '/login',
  authLimiter,
  validate({ body: loginSchema }),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body as z.infer<typeof loginSchema>;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) throw HttpError.unauthorized('Invalid credentials');
    res.json({ token: signToken(user), user: publicUser(user) });
  }),
);

authRouter.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: currentUser(req).id } });
    if (!user) throw HttpError.unauthorized('User no longer exists');
    res.json({ user: publicUser(user) });
  }),
);
