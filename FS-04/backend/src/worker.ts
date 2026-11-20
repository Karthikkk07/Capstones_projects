import { Worker } from 'bullmq';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { closeQueues, getQueue, QUEUES, redisConnection } from './lib/queue';
import { processWebhookDelivery } from './jobs/webhookDelivery';
import { processNotification } from './jobs/notification';
import { processSprintReport } from './jobs/sprintReport';

const connection = redisConnection();

const workers = [
  new Worker(QUEUES.webhooks, processWebhookDelivery, { connection, concurrency: 10 }),
  new Worker(QUEUES.notifications, processNotification, { connection, concurrency: 10 }),
  new Worker(QUEUES.sprintReports, processSprintReport, { connection, concurrency: 2 }),
];

for (const w of workers) {
  w.on('completed', (job) => logger.info({ queue: w.name, jobId: job.id }, 'job completed'));
  w.on('failed', (job, err) =>
    logger.warn({ queue: w.name, jobId: job?.id, attempt: job?.attemptsMade, err: err.message }, 'job failed'),
  );
  w.on('error', (err) => logger.error({ queue: w.name, err }, 'worker error'));
}

// Scheduled job: every day at 08:00 report on all active sprints.
getQueue(QUEUES.sprintReports)
  .upsertJobScheduler('daily-sprint-report', { pattern: '0 8 * * *' }, { name: 'daily-sprint-report', data: {} })
  .catch((err) => logger.error({ err }, 'failed to register sprint report schedule'));

logger.info('Worker started (webhook-delivery, notifications, sprint-reports)');

async function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down worker`);
  await Promise.allSettled([...workers.map((w) => w.close()), closeQueues(), prisma.$disconnect()]);
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
