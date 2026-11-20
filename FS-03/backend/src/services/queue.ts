import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../config/env';
import { TRANSCODE_QUEUE, type TranscodeJobData } from './transcode';

let connection: IORedis | undefined;
let queue: Queue<TranscodeJobData> | undefined;

export function createRedisConnection(): IORedis {
  return new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
}

function getQueue(): Queue<TranscodeJobData> {
  if (!queue) {
    connection = createRedisConnection();
    queue = new Queue<TranscodeJobData>(TRANSCODE_QUEUE, { connection });
  }
  return queue;
}

export async function enqueueTranscode(data: TranscodeJobData): Promise<string | undefined> {
  const job = await getQueue().add('video-transcode', data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  });
  return job.id;
}

export async function closeQueue(): Promise<void> {
  await queue?.close();
  connection?.disconnect();
}
