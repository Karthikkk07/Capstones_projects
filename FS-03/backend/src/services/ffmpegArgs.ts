import path from 'node:path';

export interface Rendition {
  name: string;
  height: number;
  videoBitrateK: number;
  audioBitrateK: number;
}

export const DEFAULT_RENDITIONS: Rendition[] = [
  { name: '360p', height: 360, videoBitrateK: 800, audioBitrateK: 96 },
  { name: '720p', height: 720, videoBitrateK: 2800, audioBitrateK: 128 },
];

export interface HlsOptions {
  segmentSeconds?: number;
  renditions?: Rendition[];
}

export const MASTER_PLAYLIST = 'master.m3u8';

/**
 * Pure builder: produces the ffmpeg argv for a single-pass multi-rendition HLS (VOD) transcode.
 * Output layout: <outDir>/master.m3u8, <outDir>/<name>/index.m3u8, <outDir>/<name>/seg_000.ts ...
 */
export function buildHlsArgs(input: string, outDir: string, options: HlsOptions = {}): string[] {
  const renditions = options.renditions ?? DEFAULT_RENDITIONS;
  const segment = options.segmentSeconds ?? 6;
  if (renditions.length === 0) throw new Error('At least one rendition is required');

  const splitLabels = renditions.map((_, i) => `[v${i}]`).join('');
  const filters = [
    `[0:v]split=${renditions.length}${splitLabels}`,
    ...renditions.map((r, i) => `[v${i}]scale=-2:${r.height}[v${i}out]`),
  ].join(';');

  const args: string[] = ['-y', '-i', input, '-filter_complex', filters];

  renditions.forEach((r, i) => {
    args.push(
      '-map', `[v${i}out]`,
      `-c:v:${i}`, 'libx264',
      `-b:v:${i}`, `${r.videoBitrateK}k`,
      `-maxrate:v:${i}`, `${Math.round(r.videoBitrateK * 1.07)}k`,
      `-bufsize:v:${i}`, `${r.videoBitrateK * 2}k`,
    );
  });
  renditions.forEach((r, i) => {
    args.push('-map', 'a:0', `-c:a:${i}`, 'aac', `-b:a:${i}`, `${r.audioBitrateK}k`, '-ac', '2');
  });

  args.push(
    '-preset', 'veryfast',
    '-g', '48',
    '-sc_threshold', '0',
    '-f', 'hls',
    '-hls_time', String(segment),
    '-hls_playlist_type', 'vod',
    '-hls_flags', 'independent_segments',
    '-master_pl_name', MASTER_PLAYLIST,
    '-hls_segment_filename', path.join(outDir, '%v', 'seg_%03d.ts'),
    '-var_stream_map', renditions.map((r, i) => `v:${i},a:${i},name:${r.name}`).join(' '),
    path.join(outDir, '%v', 'index.m3u8'),
  );
  return args;
}

export function buildProbeArgs(input: string): string[] {
  return ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', input];
}

export function renditionDirs(options: HlsOptions = {}): string[] {
  return (options.renditions ?? DEFAULT_RENDITIONS).map((r) => r.name);
}
