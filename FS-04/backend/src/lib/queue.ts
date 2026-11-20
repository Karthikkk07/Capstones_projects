import { Queue, type ConnectionOptions, type JobsOptions } from 'bullmq';
import { env } from '../config/env';
import { logger } from './logger';

export const QUEUES = {
  webhooks: 'webhook-delivery',
  notifications: 'notifications',
  sprintReports: 'sprint-reports',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export function redisConnection(): ConnectionOptions {
  const url = new URL(env.REDIS_URL);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : undefined,
    maxRetriesPerRequest: null,
  };
}

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 6,
  backoff: { type: 'exponential', delay: 2000 }, // 2s, 4s, 8s, 16s, 32s
  removeOnComplete: 1000,
  removeOnFail: 5000,
};

const queues = new Map<QueueName, Queue>();

/** Queues are created lazily so importing this module never opens a Redis connection. */
export function getQueue(name: QueueName): Queue {
  let queue = queues.get(name);
  if (!queue) {
    queue = new Queue(name, { connection: redisConnection(), defaultJobOptions: DEFAULT_JOB_OPTIONS });
    queue.on('error', (err) => logger.error({ err, queue: name }, 'queue error'));
    queues.set(name, queue);
  }
  return queue;
}

/**
 * Fire-and-forget enqueue: a Redis outage must never fail the HTTP request that
 * triggered the job, so errors are logged instead of thrown.
 */
export function enqueue(name: QueueName, jobName: string, data: unknown, opts?: JobsOptions): void {
  try {
    getQueue(name)
      .add(jobName, data, opts)
      .catch((err) => logger.error({ err, queue: name, jobName }, 'failed to enqueue job'));
  } catch (err) {
    logger.error({ err, queue: name, jobName }, 'failed to enqueue job');
  }
}

export async function closeQueues(): Promise<void> {
  await Promise.all([...queues.values()].map((q) => q.close()));
  queues.clear();
}
