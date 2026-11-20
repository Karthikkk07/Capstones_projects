import crypto from 'node:crypto';

export const SIGNATURE_HEADER = 'X-Signature';
export const WEBHOOK_EVENTS = [
  'issue.created',
  'issue.updated',
  'issue.moved',
  'issue.deleted',
  'comment.created',
  'sprint.started',
  'sprint.completed',
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/** HMAC-SHA256 over the exact request body, formatted as `sha256=<hex>`. */
export function signPayload(secret: string, body: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

export function verifySignature(secret: string, body: string, signature: string): boolean {
  const expected = Buffer.from(signPayload(secret, body));
  const actual = Buffer.from(signature ?? '');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export function generateWebhookSecret(): string {
  return 'whsec_' + crypto.randomBytes(24).toString('hex');
}
