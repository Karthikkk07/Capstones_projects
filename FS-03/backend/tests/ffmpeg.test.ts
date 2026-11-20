import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_RENDITIONS, buildHlsArgs } from '../src/services/ffmpegArgs';
import { runProcess } from '../src/services/ffmpegRunner';
import { processTranscodeJob } from '../src/services/transcode';
import { EventEmitter } from 'node:events';

describe('buildHlsArgs', () => {
  const args = buildHlsArgs('in.mp4', path.join('out', 'lesson1'));

  it('uses the input and produces a VOD HLS master playlist', () => {
    expect(args.slice(0, 3)).toEqual(['-y', '-i', 'in.mp4']);
    expect(args).toContain('-master_pl_name');
    expect(args[args.indexOf('-master_pl_name') + 1]).toBe('master.m3u8');
    expect(args[args.indexOf('-hls_playlist_type') + 1]).toBe('vod');
    expect(args[args.indexOf('-f') + 1]).toBe('hls');
  });

  it('builds 360p and 720p renditions', () => {
    const filter = args[args.indexOf('-filter_complex') + 1];
    expect(filter).toContain('split=2');
    expect(filter).toContain('scale=-2:360');
    expect(filter).toContain('scale=-2:720');
    expect(args[args.indexOf('-var_stream_map') + 1]).toBe('v:0,a:0,name:360p v:1,a:1,name:720p');
    expect(args).toContain('800k');
    expect(args).toContain('2800k');
  });

  it('writes segments and playlists per rendition and respects the segment length', () => {
    expect(args[args.indexOf('-hls_segment_filename') + 1]).toBe(path.join('out', 'lesson1', '%v', 'seg_%03d.ts'));
    expect(args[args.length - 1]).toBe(path.join('out', 'lesson1', '%v', 'index.m3u8'));
    expect(buildHlsArgs('a', 'b', { segmentSeconds: 10 })[buildHlsArgs('a', 'b', { segmentSeconds: 10 }).indexOf('-hls_time') + 1]).toBe('10');
  });

  it('supports custom renditions and rejects an empty list', () => {
    const custom = buildHlsArgs('a', 'b', { renditions: [DEFAULT_RENDITIONS[0]] });
    expect(custom[custom.indexOf('-filter_complex') + 1]).toContain('split=1');
    expect(() => buildHlsArgs('a', 'b', { renditions: [] })).toThrow();
  });
});

describe('runProcess', () => {
  const fakeSpawn = (code: number) => () => {
    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => {
      child.stdout.emit('data', Buffer.from('12.5\n'));
      child.emit('close', code);
    });
    return child;
  };

  it('resolves with stdout on exit code 0 and rejects otherwise', async () => {
    await expect(runProcess('ffmpeg', [], fakeSpawn(0) as any)).resolves.toMatchObject({ stdout: '12.5\n' });
    await expect(runProcess('ffmpeg', [], fakeSpawn(1) as any)).rejects.toThrow(/exited with code 1/);
  });
});

describe('processTranscodeJob', () => {
  const makeDeps = async (overrides = {}) => {
    const mediaDir = await fs.mkdtemp(path.join(process.cwd(), 'media-test-'));
    return {
      mediaDir,
      setLesson: vi.fn().mockResolvedValue(undefined),
      runFfmpeg: vi.fn().mockResolvedValue(undefined),
      probeDuration: vi.fn().mockResolvedValue(42),
      ...overrides,
    };
  };

  it('marks the lesson PROCESSING then READY with the HLS path and duration', async () => {
    const deps = await makeDeps();
    const hlsPath = await processTranscodeJob({ lessonId: 'les1', sourcePath: 'src.mp4' }, deps);
    expect(hlsPath).toBe('hls/les1/master.m3u8');
    expect(deps.runFfmpeg).toHaveBeenCalledOnce();
    expect(deps.setLesson).toHaveBeenNthCalledWith(1, 'les1', { videoStatus: 'PROCESSING' });
    expect(deps.setLesson).toHaveBeenLastCalledWith('les1', { videoStatus: 'READY', hlsPath, durationSec: 42 });
    await fs.rm(deps.mediaDir, { recursive: true, force: true });
  });

  it('uploads to S3 when an uploader is provided and removes local files', async () => {
    const uploadDir = vi.fn().mockResolvedValue(undefined);
    const deps = await makeDeps({ uploadDir });
    await processTranscodeJob({ lessonId: 'les2', sourcePath: 'src.mp4' }, deps);
    expect(uploadDir).toHaveBeenCalledWith(path.join(deps.mediaDir, 'hls', 'les2'), 'hls/les2');
    await expect(fs.access(path.join(deps.mediaDir, 'hls', 'les2'))).rejects.toThrow();
    await fs.rm(deps.mediaDir, { recursive: true, force: true });
  });

  it('marks the lesson FAILED when ffmpeg fails and rethrows', async () => {
    const deps = await makeDeps({ runFfmpeg: vi.fn().mockRejectedValue(new Error('boom')) });
    await expect(processTranscodeJob({ lessonId: 'les3', sourcePath: 'x' }, deps)).rejects.toThrow('boom');
    expect(deps.setLesson).toHaveBeenLastCalledWith('les3', { videoStatus: 'FAILED' });
    await fs.rm(deps.mediaDir, { recursive: true, force: true });
  });
});
