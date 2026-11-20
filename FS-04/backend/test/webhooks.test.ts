import crypto from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateWebhookSecret, signPayload, verifySignature } from '../src/services/webhookSigning';
import { processWebhookDelivery } from '../src/jobs/webhookDelivery';
import { emitEvent } from '../src/services/events';
import { enqueue } from '../src/lib/queue';
import { prismaMock } from './helpers/prismaMock';

describe('webhook HMAC signing', () => {
  const secret = 'whsec_test';
  const body = JSON.stringify({ event: 'issue.created', data: { id: 1 } });

  it('produces a sha256= prefixed HMAC-SHA256 hex digest', () => {
    const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
    expect(signPayload(secret, body)).toBe(`sha256=${expected}`);
  });

  it('verifies valid signatures and rejects tampered bodies, wrong secrets and garbage', () => {
    const sig = signPayload(secret, body);
    expect(verifySignature(secret, body, sig)).toBe(true);
    expect(verifySignature(secret, body + ' ', sig)).toBe(false);
    expect(verifySignature('other', body, sig)).toBe(false);
    expect(verifySignature(secret, body, 'sha256=deadbeef')).toBe(false);
    expect(verifySignature(secret, body, '')).toBe(false);
  });

  it('generates unique secrets', () => {
    expect(generateWebhookSecret()).not.toBe(generateWebhookSecret());
  });
});

describe('webhook delivery job', () => {
  const job = {
    data: {
      webhookId: 'h1',
      workspaceId: 'wsA',
      deliveryId: 'd-1',
      event: 'issue.created' as const,
      payload: { key: 'PRJ-1' },
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  };
  const hook = { id: 'h1', url: 'https://example.com/hook', secret: 'whsec_abc', active: true };

  afterEach(() => vi.unstubAllGlobals());

  it('POSTs a signed JSON body that the receiver can verify', async () => {
    prismaMock.webhook.findFirst.mockResolvedValue(hook);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    await expect(processWebhookDelivery(job)).resolves.toEqual({ status: 200 });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(hook.url);
    expect(init.method).toBe('POST');
    expect(init.headers['X-Webhook-Event']).toBe('issue.created');
    expect(verifySignature(hook.secret, init.body, init.headers['X-Signature'])).toBe(true);
    expect(JSON.parse(init.body)).toMatchObject({ id: 'd-1', event: 'issue.created', data: { key: 'PRJ-1' } });
    // webhook is loaded tenant-scoped
    expect(prismaMock.webhook.findFirst.mock.calls[0][0].where).toMatchObject({ id: 'h1', workspaceId: 'wsA' });
  });

  it('throws on a non-2xx response so BullMQ retries with backoff', async () => {
    prismaMock.webhook.findFirst.mockResolvedValue(hook);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(processWebhookDelivery(job)).rejects.toThrow(/HTTP 500/);
  });

  it('skips deleted or deactivated webhooks without calling out', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    prismaMock.webhook.findFirst.mockResolvedValue(null);
    await expect(processWebhookDelivery(job)).resolves.toEqual({ skipped: true });
    prismaMock.webhook.findFirst.mockResolvedValue({ ...hook, active: false });
    await expect(processWebhookDelivery(job)).resolves.toEqual({ skipped: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('emitEvent', () => {
  it('enqueues one delivery job per subscribed active webhook of the workspace', async () => {
    prismaMock.webhook.findMany.mockResolvedValue([{ id: 'h1' }, { id: 'h2' }]);
    await emitEvent('wsA', 'issue.moved', { key: 'PRJ-1' });

    expect(prismaMock.webhook.findMany.mock.calls[0][0].where).toMatchObject({
      workspaceId: 'wsA',
      active: true,
      events: { has: 'issue.moved' },
    });
    expect(enqueue).toHaveBeenCalledTimes(2);
    const data = vi.mocked(enqueue).mock.calls[0][2] as Record<string, unknown>;
    expect(data).toMatchObject({ webhookId: 'h1', workspaceId: 'wsA', event: 'issue.moved' });
    expect(data).not.toHaveProperty('secret');
  });

  it('never throws when the lookup fails', async () => {
    prismaMock.webhook.findMany.mockRejectedValue(new Error('db down'));
    await expect(emitEvent('wsA', 'issue.created', {})).resolves.toBeUndefined();
    expect(enqueue).not.toHaveBeenCalled();
  });
});
