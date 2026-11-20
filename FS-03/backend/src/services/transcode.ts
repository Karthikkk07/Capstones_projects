import fs from 'node:fs/promises';
import path from 'node:path';
import { MASTER_PLAYLIST, buildHlsArgs, renditionDirs } from './ffmpegArgs';

export const TRANSCODE_QUEUE = 'video-transcode';

export interface TranscodeJobData {
  lessonId: string;
  sourcePath: string;
}

export interface TranscodeDeps {
  setLesson: (lessonId: string, data: { videoStatus: 'PROCESSING' | 'READY' | 'FAILED'; hlsPath?: string; durationSec?: number | null }) => Promise<unknown>;
  runFfmpeg: (args: string[]) => Promise<unknown>;
  probeDuration: (input: string) => Promise<number | null>;
  uploadDir?: (localDir: string, keyPrefix: string) => Promise<unknown>;
  mediaDir: string;
  keepLocalAfterUpload?: boolean;
}

/**
 * Orchestrates one transcode job: mark PROCESSING -> ffmpeg -> optional S3 upload -> mark READY (or FAILED).
 * All side effects are injected so the flow is unit-testable without ffmpeg, S3 or a database.
 */
export async function processTranscodeJob(data: TranscodeJobData, deps: TranscodeDeps): Promise<string> {
  const relDir = `hls/${data.lessonId}`;
  const outDir = path.join(deps.mediaDir, 'hls', data.lessonId);
  await deps.setLesson(data.lessonId, { videoStatus: 'PROCESSING' });
  try {
    await fs.rm(outDir, { recursive: true, force: true });
    for (const name of renditionDirs()) await fs.mkdir(path.join(outDir, name), { recursive: true });

    await deps.runFfmpeg(buildHlsArgs(data.sourcePath, outDir));
    const durationSec = await deps.probeDuration(data.sourcePath);

    if (deps.uploadDir) {
      await deps.uploadDir(outDir, relDir);
      if (!deps.keepLocalAfterUpload) await fs.rm(outDir, { recursive: true, force: true });
    }

    const hlsPath = `${relDir}/${MASTER_PLAYLIST}`;
    await deps.setLesson(data.lessonId, { videoStatus: 'READY', hlsPath, durationSec });
    return hlsPath;
  } catch (err) {
    await deps.setLesson(data.lessonId, { videoStatus: 'FAILED' });
    throw err;
  }
}
