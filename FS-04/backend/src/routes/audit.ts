import { Router } from 'express';
import { z } from 'zod';
import { scoped } from '../lib/scoped';
import { parse } from '../lib/validate';
import { ctx, requirePermission } from '../middleware/auth';

const querySchema = z.object({
  entity: z.string().optional(),
  action: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const auditRouter = Router();

auditRouter.get('/audit-logs', requirePermission('audit:read'), async (req, res) => {
  const { workspaceId } = ctx(req);
  const q = parse(querySchema, req.query);
  const where = { ...(q.entity && { entity: q.entity }), ...(q.action && { action: { startsWith: q.action } }) };
  const db = scoped(workspaceId);
  const [items, total] = await Promise.all([
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: q.limit,
      skip: q.offset,
      include: { actor: { select: { id: true, name: true, email: true } } },
    }),
    db.auditLog.count({ where }),
  ]);
  res.json({ items, total });
});
