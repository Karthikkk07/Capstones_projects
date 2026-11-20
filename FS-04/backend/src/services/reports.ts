import { scoped } from '../lib/scoped';
import { notFound } from '../lib/errors';

export interface BurndownPoint {
  date: string;
  ideal: number;
}

/** Straight ideal line from totalPoints on the first day to 0 on the last day (inclusive). */
export function computeBurndown(totalPoints: number, start: Date, end: Date): BurndownPoint[] {
  const day = 24 * 60 * 60 * 1000;
  const s = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const e = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  const days = Math.max(1, Math.round((e - s) / day));
  const points: BurndownPoint[] = [];
  for (let i = 0; i <= days; i++) {
    const ideal = Math.round((totalPoints - (totalPoints * i) / days) * 100) / 100;
    points.push({ date: new Date(s + i * day).toISOString().slice(0, 10), ideal });
  }
  return points;
}

export async function buildSprintReport(workspaceId: string, sprintId: string) {
  const db = scoped(workspaceId);
  const sprint = await db.sprint.findFirst({ where: { id: sprintId } });
  if (!sprint) throw notFound('Sprint');

  const issues = await db.issue.findMany({
    where: { sprintId },
    include: { status: { select: { name: true, category: true } } },
  });

  const totalIssues = issues.length;
  const completedIssues = issues.filter((i) => i.status.category === 'DONE');
  const totalPoints = issues.reduce((sum, i) => sum + (i.storyPoints ?? 0), 0);
  const completedPoints = completedIssues.reduce((sum, i) => sum + (i.storyPoints ?? 0), 0);

  const byStatus: Record<string, number> = {};
  for (const i of issues) byStatus[i.status.name] = (byStatus[i.status.name] ?? 0) + 1;

  const start = sprint.startDate ?? sprint.createdAt;
  const end = sprint.endDate ?? new Date(start.getTime() + 14 * 24 * 60 * 60 * 1000);

  return {
    sprint: {
      id: sprint.id,
      name: sprint.name,
      goal: sprint.goal,
      state: sprint.state,
      startDate: sprint.startDate,
      endDate: sprint.endDate,
    },
    totals: {
      issues: totalIssues,
      completedIssues: completedIssues.length,
      points: totalPoints,
      completedPoints,
      remainingPoints: totalPoints - completedPoints,
      completionPercent: totalIssues === 0 ? 0 : Math.round((completedIssues.length / totalIssues) * 100),
    },
    byStatus,
    burndown: computeBurndown(totalPoints, start, end),
  };
}
