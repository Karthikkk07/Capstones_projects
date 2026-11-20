import { Router } from 'express';
import { enqueue, QUEUES } from '../lib/queue';
import { ctx, requirePermission } from '../middleware/auth';
import { buildSprintReport } from '../services/reports';

export const reportsRouter = Router();

reportsRouter.get('/reports/sprints/:id', requirePermission('report:read'), async (req, res) => {
  res.json(await buildSprintReport(ctx(req).workspaceId, req.params.id));
});

// Queues a sprint report job that notifies the workspace owners/admins.
reportsRouter.post('/reports/sprints/:id/send', requirePermission('sprint:write'), async (req, res) => {
  const { workspaceId } = ctx(req);
  await buildSprintReport(workspaceId, req.params.id); // 404 for foreign/unknown sprints
  enqueue(QUEUES.sprintReports, 'sprint-report', { workspaceId, sprintId: req.params.id });
  res.status(202).json({ queued: true });
});
