import { Router } from 'express';
import { z } from 'zod';
import { scoped } from '../lib/scoped';
import { parse } from '../lib/validate';
import { notFound } from '../lib/errors';
import { ctx, requirePermission } from '../middleware/auth';
import { recordAudit } from '../services/audit';
import { generateWebhookSecret, WEBHOOK_EVENTS } from '../services/webhookSigning';

const url = z
  .url()
  .refine((u) => ['http:', 'https:'].includes(new URL(u).protocol), 'URL must use http or https');
const events = z.array(z.enum(WEBHOOK_EVENTS)).min(1);

const createSchema = z.object({ url, events, active: z.boolean().default(true), secret: z.string().min(16).max(128).optional() });
const updateSchema = z
  .object({ url, events, active: z.boolean() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'At least one field is required');

const mask = <T extends { secret: string }>(hook: T) => ({ ...hook, secret: `${hook.secret.slice(0, 6)}…` });

export const webhooksRouter = Router();

webhooksRouter.get('/webhooks/events', requirePermission('webhook:manage'), (_req, res) => {
  res.json({ events: WEBHOOK_EVENTS });
});

webhooksRouter.get('/webhooks', requirePermission('webhook:manage'), async (req, res) => {
  const hooks = await scoped(ctx(req).workspaceId).webhook.findMany({ orderBy: { createdAt: 'asc' } });
  res.json({ items: hooks.map(mask) });
});

// The full secret is only ever returned here, once, at creation time.
webhooksRouter.post('/webhooks', requirePermission('webhook:manage'), async (req, res) => {
  const auth = ctx(req);
  const body = parse(createSchema, req.body);
  const hook = await scoped(auth.workspaceId).webhook.create({
    data: {
      workspaceId: auth.workspaceId,
      url: body.url,
      events: body.events,
      active: body.active,
      secret: body.secret ?? generateWebhookSecret(),
    },
  });
  await recordAudit({
    workspaceId: auth.workspaceId,
    actorId: auth.userId,
    action: 'webhook.created',
    entity: 'webhook',
    entityId: hook.id,
    meta: { after: { url: hook.url, events: hook.events } },
  });
  res.status(201).json(hook);
});

webhooksRouter.patch('/webhooks/:id', requirePermission('webhook:manage'), async (req, res) => {
  const auth = ctx(req);
  const patch = parse(updateSchema, req.body);
  const db = scoped(auth.workspaceId);
  const before = await db.webhook.findFirst({ where: { id: req.params.id } });
  if (!before) throw notFound('Webhook');
  await db.webhook.updateMany({ where: { id: before.id }, data: patch });
  const after = await db.webhook.findFirst({ where: { id: before.id } });
  await recordAudit({
    workspaceId: auth.workspaceId,
    actorId: auth.userId,
    action: 'webhook.updated',
    entity: 'webhook',
    entityId: before.id,
    meta: { before: { url: before.url, events: before.events, active: before.active }, after: patch },
  });
  res.json(after && mask(after));
});

webhooksRouter.delete('/webhooks/:id', requirePermission('webhook:manage'), async (req, res) => {
  const auth = ctx(req);
  const db = scoped(auth.workspaceId);
  const hook = await db.webhook.findFirst({ where: { id: req.params.id } });
  if (!hook) throw notFound('Webhook');
  await db.webhook.deleteMany({ where: { id: hook.id } });
  await recordAudit({
    workspaceId: auth.workspaceId,
    actorId: auth.userId,
    action: 'webhook.deleted',
    entity: 'webhook',
    entityId: hook.id,
    meta: { before: { url: hook.url } },
  });
  res.status(204).end();
});
