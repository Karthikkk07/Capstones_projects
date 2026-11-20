import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authHeader, prismaMock, resetPrismaMock } from './helpers';

vi.mock('../src/lib/prisma', async () => ({ prisma: (await import('./helpers')).prismaMock }));
vi.mock('../src/services/queue', () => ({ enqueueTranscode: vi.fn().mockResolvedValue('job-1') }));

import { createApp } from '../src/app';

const app = createApp();
const course = { id: 'course1', title: 'Course', slug: 'course', instructorId: 'inst1', priceCents: 0, status: 'DRAFT' };

beforeEach(() => resetPrismaMock());

describe('authentication & role enforcement', () => {
  it('rejects unauthenticated requests with 401', async () => {
    await request(app).post('/courses').send({ title: 'Anything' }).expect(401);
  });

  it('forbids a student from creating a course (403)', async () => {
    const res = await request(app)
      .post('/courses')
      .set(authHeader('stu1', 'STUDENT'))
      .send({ title: 'My course', description: 'desc' });
    expect(res.status).toBe(403);
    expect(prismaMock.course.create).not.toHaveBeenCalled();
  });

  it('lets an instructor create a course owned by themselves', async () => {
    prismaMock.course.findUnique.mockResolvedValue(null);
    prismaMock.course.create.mockImplementation(async ({ data }: any) => ({ id: 'c9', ...data }));
    const res = await request(app)
      .post('/courses')
      .set(authHeader('inst1', 'INSTRUCTOR'))
      .send({ title: 'Intro to Node', description: 'All about node', priceCents: 1999 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ instructorId: 'inst1', slug: 'intro-to-node', priceCents: 1999 });
  });

  it("forbids an instructor from editing another instructor's course (403)", async () => {
    prismaMock.course.findUnique.mockResolvedValue(course);
    const res = await request(app).patch('/courses/course1').set(authHeader('other', 'INSTRUCTOR')).send({ title: 'Hijacked' });
    expect(res.status).toBe(403);
    expect(prismaMock.course.update).not.toHaveBeenCalled();
  });

  it('allows the owner and an admin to edit', async () => {
    prismaMock.course.findUnique.mockResolvedValue(course);
    prismaMock.course.update.mockResolvedValue({ ...course, title: 'Renamed' });
    await request(app).patch('/courses/course1').set(authHeader('inst1', 'INSTRUCTOR')).send({ title: 'Renamed' }).expect(200);
    await request(app).patch('/courses/course1').set(authHeader('admin1', 'ADMIN')).send({ title: 'Renamed' }).expect(200);
  });

  it('forbids instructors from uploading a video to a lesson in someone else\'s course', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue({ id: 'les1', type: 'VIDEO', course });
    const res = await request(app).post('/lessons/les1/video').set(authHeader('other', 'INSTRUCTOR'));
    expect(res.status).toBe(403);
  });

  it('only lets admins list all courses for moderation', async () => {
    await request(app).get('/admin/courses').set(authHeader('inst1', 'INSTRUCTOR')).expect(403);
  });
});

describe('registration', () => {
  it('does not allow self-registering as ADMIN', async () => {
    const res = await request(app).post('/auth/register').send({ email: 'a@b.co', password: 'password123', name: 'Eve', role: 'ADMIN' });
    expect(res.status).toBe(400);
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it('registers a student and returns a JWT', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.create.mockImplementation(async ({ data }: any) => ({ id: 'u1', ...data }));
    const res = await request(app).post('/auth/register').send({ email: 'S@Test.io', password: 'password123', name: 'Sam' });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email: 's@test.io', role: 'STUDENT' });
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.passwordHash).toBeUndefined();
  });
});

describe('infrastructure', () => {
  it('serves /health', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('returns JSON 404s', async () => {
    const res = await request(app).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });
});
