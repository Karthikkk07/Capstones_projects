import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authHeader, prismaMock, resetPrismaMock } from './helpers';

vi.mock('../src/lib/prisma', async () => ({ prisma: (await import('./helpers')).prismaMock }));
vi.mock('../src/services/queue', () => ({ enqueueTranscode: vi.fn() }));

import { createApp } from '../src/app';

const app = createApp();
const course = { id: 'course1', instructorId: 'inst1', status: 'PUBLISHED' };
const readyLesson = { id: 'les1', courseId: 'course1', type: 'VIDEO', videoStatus: 'READY', hlsPath: 'hls/les1/master.m3u8', course };

beforeEach(() => resetPrismaMock());

describe('GET /lessons/:id/playback (enrollment gating)', () => {
  it('requires authentication', async () => {
    await request(app).get('/lessons/les1/playback').expect(401);
  });

  it('denies a student who is not enrolled', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue(readyLesson);
    prismaMock.enrollment.findUnique.mockResolvedValue(null);
    const res = await request(app).get('/lessons/les1/playback').set(authHeader('stu1', 'STUDENT'));
    expect(res.status).toBe(403);
    expect(res.body.url).toBeUndefined();
  });

  it('returns the HLS URL for an enrolled student', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue(readyLesson);
    prismaMock.enrollment.findUnique.mockResolvedValue({ id: 'e1' });
    const res = await request(app).get('/lessons/les1/playback').set(authHeader('stu1', 'STUDENT'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ lessonId: 'les1', url: '/media/hls/les1/master.m3u8', strategy: 'local' });
  });

  it('lets the owning instructor and admins preview without enrollment', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue(readyLesson);
    await request(app).get('/lessons/les1/playback').set(authHeader('inst1', 'INSTRUCTOR')).expect(200);
    await request(app).get('/lessons/les1/playback').set(authHeader('admin1', 'ADMIN')).expect(200);
    expect(prismaMock.enrollment.findUnique).not.toHaveBeenCalled();
  });

  it('answers 409 while the video is still processing', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue({ ...readyLesson, videoStatus: 'PROCESSING', hlsPath: null });
    const res = await request(app).get('/lessons/les1/playback').set(authHeader('inst1', 'INSTRUCTOR'));
    expect(res.status).toBe(409);
    expect(res.body.videoStatus).toBe('PROCESSING');
  });
});

describe('POST /lessons/:id/progress', () => {
  it('rejects users who are not enrolled', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue(readyLesson);
    prismaMock.enrollment.findUnique.mockResolvedValue(null);
    await request(app).post('/lessons/les1/progress').set(authHeader('stu1', 'STUDENT')).send({ completed: true }).expect(403);
  });
});
