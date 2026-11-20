import crypto from 'node:crypto';
import { scoped } from '../lib/scoped';
import { enqueue, QUEUES } from '../lib/queue';
import { logger } from '../lib/logger';
import type { WebhookEvent } from './webhookSigning';

export interface WebhookJobData {
  webhookId: string;
  workspaceId: string;
  deliveryId: string;
  event: WebhookEvent;
  payload: unknown;
  createdAt: string;
}

/**
 * Fans an event out to every active webhook of the workspace that subscribes to it.
 * Only ids go on the queue - the worker loads the (secret-bearing) webhook row itself.
 */
export async function emitEvent(workspaceId: string, event: WebhookEvent, payload: unknown): Promise<void> {
  try {
    const hooks = await scoped(workspaceId).webhook.findMany({
      where: { active: true, events: { has: event } },
      select: { id: true },
    });
    for (const hook of hooks) {
      const data: WebhookJobData = {
        webhookId: hook.id,
        workspaceId,
        deliveryId: crypto.randomUUID(),
        event,
        payload,
        createdAt: new Date().toISOString(),
      };
      enqueue(QUEUES.webhooks, event, data);
    }
  } catch (err) {
    logger.error({ err, event }, 'failed to dispatch webhook event');
  }
}
