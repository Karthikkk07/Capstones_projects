import crypto from 'node:crypto';
import PDFDocument from 'pdfkit';
import type { PrismaClient } from '@prisma/client';
import { evaluateCompletion, type CompletionStatus } from './progress';

export function generateCertificateCode(): string {
  const hex = crypto.randomBytes(6).toString('hex').toUpperCase();
  return `LMS-${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
}

export interface CertificateData {
  studentName: string;
  courseTitle: string;
  issuedAt: Date;
  code: string;
  verifyUrl?: string;
}

export function generateCertificatePdf(data: CertificateData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const { width, height } = doc.page;
    doc.rect(25, 25, width - 50, height - 50).lineWidth(3).stroke('#1d4ed8');
    doc.fontSize(34).fillColor('#1d4ed8').text('Certificate of Completion', 0, 110, { align: 'center' });
    doc.moveDown(1.2).fontSize(16).fillColor('#374151').text('This is to certify that', { align: 'center' });
    doc.moveDown(0.6).fontSize(30).fillColor('#111827').text(data.studentName, { align: 'center' });
    doc.moveDown(0.6).fontSize(16).fillColor('#374151').text('has successfully completed the course', { align: 'center' });
    doc.moveDown(0.6).fontSize(24).fillColor('#111827').text(data.courseTitle, { align: 'center' });
    doc.moveDown(1.5).fontSize(12).fillColor('#374151');
    doc.text(`Issued on ${data.issuedAt.toISOString().slice(0, 10)}`, { align: 'center' });
    doc.text(`Certificate code: ${data.code}`, { align: 'center' });
    if (data.verifyUrl) doc.text(`Verify at: ${data.verifyUrl}`, { align: 'center' });
    doc.end();
  });
}

type Db = Pick<PrismaClient, 'lesson' | 'lessonProgress' | 'quiz' | 'quizAttempt' | 'certificate' | 'enrollment'>;

export async function getCompletionStatus(db: Db, userId: string, courseId: string): Promise<CompletionStatus> {
  const [lessons, progress, quizzes, attempts] = await Promise.all([
    db.lesson.findMany({ where: { courseId }, select: { id: true } }),
    db.lessonProgress.findMany({ where: { userId, courseId, completed: true }, select: { lessonId: true } }),
    db.quiz.findMany({ where: { courseId, required: true, questions: { some: {} } }, select: { id: true } }),
    db.quizAttempt.findMany({ where: { userId, passed: true, quiz: { courseId } }, select: { quizId: true } }),
  ]);
  return evaluateCompletion({
    lessonIds: lessons.map((l) => l.id),
    completedLessonIds: progress.map((p) => p.lessonId),
    requiredQuizIds: quizzes.map((q) => q.id),
    passedQuizIds: attempts.map((a) => a.quizId),
  });
}

/** Issues (once) a certificate when the learner has finished every lesson and passed every required quiz. */
export async function issueCertificateIfEligible(db: Db, userId: string, courseId: string) {
  const status = await getCompletionStatus(db, userId, courseId);
  if (!status.complete) return { eligible: false as const, status, certificate: null };

  let certificate = await db.certificate.findUnique({ where: { userId_courseId: { userId, courseId } } });
  if (!certificate) {
    certificate = await db.certificate.create({ data: { userId, courseId, code: generateCertificateCode() } });
    await db.enrollment.updateMany({ where: { userId, courseId, completedAt: null }, data: { completedAt: new Date() } });
  }
  return { eligible: true as const, status, certificate };
}
