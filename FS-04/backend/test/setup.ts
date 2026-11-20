import { beforeEach, vi } from 'vitest';
import { prismaMock, resetPrismaMock } from './helpers/prismaMock';

vi.mock('../src/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('../src/lib/queue', () => ({
  QUEUES: { webhooks: 'webhook-delivery', notifications: 'notifications', sprintReports: 'sprint-reports' },
  enqueue: vi.fn(),
  getQueue: vi.fn(),
  closeQueues: vi.fn(),
  redisConnection: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  resetPrismaMock();
});
