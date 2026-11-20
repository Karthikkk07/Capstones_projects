import type { Role } from '@prisma/client';
import { HttpError } from '../lib/errors';
import type { AuthUser } from '../lib/jwt';
import { prisma } from '../lib/prisma';
import { canAccessCourse } from './access';

export async function loadLiveClassForUser(user: AuthUser, liveClassId: string) {
  const liveClass = await prisma.liveClass.findUnique({
    where: { id: liveClassId },
    include: { course: { select: { id: true, instructorId: true, title: true } } },
  });
  if (!liveClass) throw HttpError.notFound('Live class not found');
  if (!(await canAccessCourse(user, liveClass.course))) throw HttpError.forbidden('Enroll in the course to join its live classes');
  return liveClass;
}

export const isLiveHost = (user: { id: string; role: Role }, course: { instructorId: string }) =>
  course.instructorId === user.id;
