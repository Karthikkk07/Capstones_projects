import type { Job } from 'bullmq';
import { scoped } from '../lib/scoped';
import type { WebhookJobData } from '../services/events';
import { SIGNATURE_HEADER, signPayload } from '../services/webhookSigning';

const TIMEOUT_MS = 10_000;

/**
 * Delivers one webhook. Throwing on a non-2xx response (or network error) makes
 * BullMQ retry the job with the queue's exponential backoff.
 */
export async function processWebhookDelivery(job: Pick<Job<WebhookJobData>, 'data'>): Promise<{ status: number } | { skipped: true }> {
  const { webhookId, workspaceId, deliveryId, event, payload, createdAt } = job.data;
  const hook = await scoped(workspaceId).webhook.findFirst({ where: { id: webhookId } });
  if (!hook || !hook.active) return { skipped: true };

  const body = JSON.stringify({ id: deliveryId, event, workspaceId, createdAt, data: payload });
  const res = await fetch(hook.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'FS04-Webhooks/1.0',
      [SIGNATURE_HEADER]: signPayload(hook.secret, body),
      'X-Webhook-Event': event,
      'X-Webhook-Delivery': deliveryId,
    },
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Webhook ${webhookId} responded with HTTP ${res.status}`);
  return { status: res.status };
}
