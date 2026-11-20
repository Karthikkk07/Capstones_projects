import { Worker } from 'bullmq';
import { env } from './config/env';
import { prisma } from './lib/prisma';
import { createRedisConnection } from './services/queue';
import { probeDurationSec, runProcess } from './services/ffmpegRunner';
import { uploadDirectoryToS3 } from './services/storage';
import { TRANSCODE_QUEUE, type TranscodeJobData, processTranscodeJob } from './services/transcode';

const worker = new Worker<TranscodeJobData>(
  TRANSCODE_QUEUE,
  (job) =>
    processTranscodeJob(job.data, {
      mediaDir: env.MEDIA_DIR,
      keepLocalAfterUpload: env.KEEP_LOCAL_AFTER_S3,
      setLesson: (lessonId, data) => prisma.lesson.update({ where: { id: lessonId }, data }),
      runFfmpeg: (args) => runProcess(env.FFMPEG_PATH, args),
      probeDuration: (input) => probeDurationSec(input, env.FFPROBE_PATH),
      uploadDir: env.S3_BUCKET
        ? (dir, prefix) => uploadDirectoryToS3(dir, prefix, { bucket: env.S3_BUCKET!, region: env.S3_REGION })
        : undefined,
    }),
  { connection: createRedisConnection(), concurrency: 1 },
);

worker.on('completed', (job, hlsPath) => console.log(`[worker] job ${job.id} done -> ${hlsPath}`));
worker.on('failed', (job, err) => console.error(`[worker] job ${job?.id} failed:`, err.message));
console.log(`[worker] listening on queue "${TRANSCODE_QUEUE}" (S3 ${env.S3_BUCKET ? 'enabled' : 'disabled, keeping files local'})`);

const shutdown = async () => {
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
