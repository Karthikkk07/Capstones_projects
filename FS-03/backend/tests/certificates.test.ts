import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authHeader, prismaMock, resetPrismaMock } from './helpers';
import { generateCertificateCode, generateCertificatePdf, issueCertificateIfEligible } from '../src/services/certificates';

vi.mock('../src/lib/prisma', async () => ({ prisma: (await import('./helpers')).prismaMock }));
vi.mock('../src/services/queue', () => ({ enqueueTranscode: vi.fn() }));

import { createApp } from '../src/app';

beforeEach(() => resetPrismaMock());

function mockCompletionData(opts: { lessons: string[]; done: string[]; requiredQuizzes: string[]; passed: string[] }) {
  prismaMock.lesson.findMany.mockResolvedValue(opts.lessons.map((id) => ({ id })));
  prismaMock.lessonProgress.findMany.mockResolvedValue(opts.done.map((lessonId) => ({ lessonId })));
  prismaMock.quiz.findMany.mockResolvedValue(opts.requiredQuizzes.map((id) => ({ id })));
  prismaMock.quizAttempt.findMany.mockResolvedValue(opts.passed.map((quizId) => ({ quizId })));
}

describe('issueCertificateIfEligible', () => {
  it('issues a certificate when all lessons are done and required quizzes passed', async () => {
    mockCompletionData({ lessons: ['l1', 'l2'], done: ['l1', 'l2'], requiredQuizzes: ['q1'], passed: ['q1'] });
    prismaMock.certificate.findUnique.mockResolvedValue(null);
    prismaMock.certificate.create.mockImplementation(async ({ data }: any) => ({ id: 'cert1', ...data }));

    const result = await issueCertificateIfEligible(prismaMock, 'u1', 'c1');
    expect(result.eligible).toBe(true);
    expect(result.certificate?.code).toMatch(/^LMS-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
    expect(prismaMock.enrollment.updateMany).toHaveBeenCalledOnce();
  });

  it('does not issue when a lesson or required quiz is outstanding', async () => {
    mockCompletionData({ lessons: ['l1', 'l2'], done: ['l1'], requiredQuizzes: [], passed: [] });
    expect((await issueCertificateIfEligible(prismaMock, 'u1', 'c1')).eligible).toBe(false);
    mockCompletionData({ lessons: ['l1'], done: ['l1'], requiredQuizzes: ['q1'], passed: [] });
    expect((await issueCertificateIfEligible(prismaMock, 'u1', 'c1')).eligible).toBe(false);
    expect(prismaMock.certificate.create).not.toHaveBeenCalled();
  });

  it('is idempotent: returns the existing certificate without creating another', async () => {
    mockCompletionData({ lessons: ['l1'], done: ['l1'], requiredQuizzes: [], passed: [] });
    prismaMock.certificate.findUnique.mockResolvedValue({ id: 'cert1', code: 'LMS-AAAA-BBBB-CCCC' });
    const result = await issueCertificateIfEligible(prismaMock, 'u1', 'c1');
    expect(result.certificate?.id).toBe('cert1');
    expect(prismaMock.certificate.create).not.toHaveBeenCalled();
  });

  it('generates unique-looking codes', () => {
    expect(new Set(Array.from({ length: 50 }, generateCertificateCode)).size).toBe(50);
  });
});

describe('certificate PDF & endpoints', () => {
  const app = createApp();
  const cert = {
    id: 'cert1',
    userId: 'u1',
    code: 'LMS-AAAA-BBBB-CCCC',
    issuedAt: new Date('2026-01-02T00:00:00Z'),
    user: { name: 'Ada Lovelace' },
    course: { title: 'Analytical Engines 101' },
  };

  it('generates a PDF buffer that starts with %PDF', async () => {
    const pdf = await generateCertificatePdf({ studentName: 'Ada', courseTitle: 'Course', issuedAt: new Date(), code: 'LMS-1' });
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('serves the PDF to the owner only', async () => {
    prismaMock.certificate.findUnique.mockResolvedValue(cert);
    const ok = await request(app).get('/certificates/cert1/pdf').set(authHeader('u1', 'STUDENT'));
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toBe('application/pdf');
    expect(ok.body.subarray(0, 4).toString()).toBe('%PDF');
    await request(app).get('/certificates/cert1/pdf').set(authHeader('u2', 'STUDENT')).expect(403);
  });

  it('verifies a certificate publicly by code', async () => {
    prismaMock.certificate.findUnique.mockResolvedValue(cert);
    const res = await request(app).get('/certificates/verify/lms-aaaa-bbbb-cccc');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ valid: true, studentName: 'Ada Lovelace', courseTitle: 'Analytical Engines 101' });
    expect(prismaMock.certificate.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { code: 'LMS-AAAA-BBBB-CCCC' } }));
  });

  it('returns 404 for an unknown code', async () => {
    prismaMock.certificate.findUnique.mockResolvedValue(null);
    const res = await request(app).get('/certificates/verify/NOPE');
    expect(res.status).toBe(404);
    expect(res.body.valid).toBe(false);
  });
});
