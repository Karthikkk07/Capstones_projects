import { type ChildProcess, spawn, type SpawnOptions } from 'node:child_process';
import { buildProbeArgs } from './ffmpegArgs';

export type SpawnFn = (cmd: string, args: string[], opts?: SpawnOptions) => ChildProcess;

const defaultSpawn: SpawnFn = (cmd, args, opts) => spawn(cmd, args, opts ?? {});

export interface RunResult {
  stdout: string;
  stderr: string;
}

/** Thin process executor (the only place that spawns ffmpeg). Spawn is injectable for tests. */
export function runProcess(cmd: string, args: string[], spawnFn: SpawnFn = defaultSpawn): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawnFn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => (stdout += d.toString()));
    child.stderr?.on('data', (d) => {
      stderr = (stderr + d.toString()).slice(-8000); // keep the tail only
    });
    child.on('error', (err) => reject(new Error(`Failed to start ${cmd}: ${err.message}`)));
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} exited with code ${code}: ${stderr.slice(-500)}`));
    });
  });
}

export async function probeDurationSec(
  input: string,
  ffprobePath = 'ffprobe',
  spawnFn: SpawnFn = defaultSpawn,
): Promise<number | null> {
  try {
    const { stdout } = await runProcess(ffprobePath, buildProbeArgs(input), spawnFn);
    const seconds = parseFloat(stdout.trim());
    return Number.isFinite(seconds) ? Math.round(seconds) : null;
  } catch {
    return null;
  }
}
