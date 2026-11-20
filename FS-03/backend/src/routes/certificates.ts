import { Router } from 'express';
import { env } from '../config/env';
import { asyncHandler } from '../lib/asyncHandler';
import { HttpError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { authenticate, currentUser } from '../middleware/auth';
import { generateCertificatePdf, issueCertificateIfEligible } from '../services/certificates';
import { isEnrolled } from '../services/access';

export const certificatesRouter = Router();

certificatesRouter.get(
  '/certificates',
  authenticate,
  asyncHandler(async (req, res) => {
    const items = await prisma.certificate.findMany({
      where: { userId: currentUser(req).id },
      orderBy: { issuedAt: 'desc' },
      include: { course: { select: { id: true, title: true } } },
    });
    res.json({ items });
  }),
);

// Public verification endpoint (no auth) - must be declared before /certificates/:id
certificatesRouter.get(
  '/certificates/verify/:code',
  asyncHandler(async (req, res) => {
    const cert = await prisma.certificate.findUnique({
      where: { code: req.params.code.toUpperCase() },
      include: { user: { select: { name: true } }, course: { select: { title: true } } },
    });
    if (!cert) return res.status(404).json({ valid: false, error: 'Certificate not found' });
    res.json({ valid: true, code: cert.code, studentName: cert.user.name, courseTitle: cert.course.title, issuedAt: cert.issuedAt });
  }),
);

certificatesRouter.get(
  '/certificates/:id/pdf',
  authenticate,
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const cert = await prisma.certificate.findUnique({
      where: { id: req.params.id },
      include: { user: { select: { name: true } }, course: { select: { title: true } } },
    });
    if (!cert) throw HttpError.notFound('Certificate not found');
    if (cert.userId !== user.id && user.role !== 'ADMIN') throw HttpError.forbidden();
    const pdf = await generateCertificatePdf({
      studentName: cert.user.name,
      courseTitle: cert.course.title,
      issuedAt: cert.issuedAt,
      code: cert.code,
      verifyUrl: `${env.FRONTEND_URL}/verify/${cert.code}`,
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="certificate-${cert.code}.pdf"`);
    res.send(pdf);
  }),
);

certificatesRouter.post(
  '/courses/:id/certificate',
  authenticate,
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    if (!(await isEnrolled(user.id, req.params.id))) throw HttpError.forbidden('You are not enrolled in this course');
    const result = await issueCertificateIfEligible(prisma, user.id, req.params.id);
    if (!result.eligible) return res.status(409).json({ error: 'Course not completed yet', status: result.status });
    res.json(result.certificate);
  }),
);
