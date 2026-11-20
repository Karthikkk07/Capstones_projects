import type { Job } from 'bullmq';
import { prisma } from '../lib/prisma';
import { getNotifier } from '../services/notifier';
import type { NotificationJobData } from '../services/notify';

export async function processNotification(job: Pick<Job<NotificationJobData>, 'data'>): Promise<{ sent: boolean }> {
  const d = job.data;
  const user = await prisma.user.findUnique({
    where: { id: d.recipientId },
    select: { id: true, email: true, name: true },
  });
  if (!user) return { sent: false };

  const subject =
    d.type === 'issue.assigned'
      ? `${d.issueKey} was assigned to you`
      : `New comment on ${d.issueKey}`;
  const body =
    d.type === 'issue.assigned'
      ? `${d.actorName ?? 'Someone'} assigned you "${d.title}" (${d.issueKey}).`
      : `${d.actorName ?? 'Someone'} commented on "${d.title}" (${d.issueKey}): ${d.excerpt ?? ''}`;

  await getNotifier().send({ to: user, subject, body, type: d.type });
  return { sent: true };
}
