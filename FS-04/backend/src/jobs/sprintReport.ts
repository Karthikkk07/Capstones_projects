import type { Job } from 'bullmq';
import { prisma } from '../lib/prisma';
import { getNotifier } from '../services/notifier';
import { buildSprintReport } from '../services/reports';

export interface SprintReportJobData {
  workspaceId?: string;
  sprintId?: string; // when omitted the job scans all active sprints (scheduled run)
}

async function reportOne(workspaceId: string, sprintId: string): Promise<void> {
  const report = await buildSprintReport(workspaceId, sprintId);
  const admins = await prisma.membership.findMany({
    where: { workspaceId, role: { in: ['OWNER', 'ADMIN'] } },
    select: { user: { select: { id: true, email: true, name: true } } },
  });
  const t = report.totals;
  const body =
    `Sprint "${report.sprint.name}" (${report.sprint.state}): ${t.completedIssues}/${t.issues} issues done, ` +
    `${t.completedPoints}/${t.points} points (${t.completionPercent}%).`;
  for (const { user } of admins) {
    await getNotifier().send({ to: user, subject: `Sprint report: ${report.sprint.name}`, body, type: 'sprint.report' });
  }
}

export async function processSprintReport(job: Pick<Job<SprintReportJobData>, 'data'>): Promise<{ reports: number }> {
  const { workspaceId, sprintId } = job.data;
  if (workspaceId && sprintId) {
    await reportOne(workspaceId, sprintId);
    return { reports: 1 };
  }
  const active = await prisma.sprint.findMany({ where: { state: 'ACTIVE' }, select: { id: true, workspaceId: true } });
  for (const s of active) await reportOne(s.workspaceId, s.id);
  return { reports: active.length };
}
