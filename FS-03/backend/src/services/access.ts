import type { AuthUser } from '../lib/jwt';
import { prisma } from '../lib/prisma';

export async function isEnrolled(userId: string, courseId: string): Promise<boolean> {
  const enrollment = await prisma.enrollment.findUnique({
    where: { userId_courseId: { userId, courseId } },
    select: { id: true },
  });
  return Boolean(enrollment);
}

/** Admins, the owning instructor and enrolled students may consume course content. */
export async function canAccessCourse(
  user: AuthUser | undefined,
  course: { id: string; instructorId: string },
): Promise<boolean> {
  if (!user) return false;
  if (user.role === 'ADMIN' || course.instructorId === user.id) return true;
  return isEnrolled(user.id, course.id);
}

export const isCourseManager = (user: AuthUser, course: { instructorId: string }) =>
  user.role === 'ADMIN' || course.instructorId === user.id;
