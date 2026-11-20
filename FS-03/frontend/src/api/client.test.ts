import { describe, expect, it, vi } from 'vitest';
import { ApiError, buildQuery, createApi } from './client';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('buildQuery', () => {
  it('skips empty values and encodes the rest', () => {
    expect(buildQuery({ q: 'node js', page: 2, category: '', x: undefined })).toBe('?q=node+js&page=2');
    expect(buildQuery()).toBe('');
  });
});

describe('api client', () => {
  it('sends the bearer token, JSON body and base URL', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ token: 't', user: { id: '1' } }));
    const api = createApi({ baseUrl: '/api', getToken: () => 'jwt-123', fetchImpl });
    await api.login({ email: 'a@b.co', password: 'secret' });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('/api/auth/login');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ email: 'a@b.co', password: 'secret' }));
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer jwt-123');
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
  });

  it('builds catalog queries', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ items: [] }));
    await createApi({ fetchImpl }).listCourses({ q: 'react', page: 3 });
    expect(fetchImpl.mock.calls[0][0]).toBe('/api/courses?q=react&page=3');
  });

  it('throws ApiError with the server message and triggers onUnauthorized on 401', async () => {
    const onUnauthorized = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: 'Invalid credentials' }, 401));
    const api = createApi({ fetchImpl, onUnauthorized });
    await expect(api.me()).rejects.toMatchObject({ name: 'ApiError', status: 401, message: 'Invalid credentials' });
    expect(onUnauthorized).toHaveBeenCalledOnce();
    await expect(api.me()).rejects.toBeInstanceOf(ApiError);
  });

  it('does not set a JSON content-type for multipart uploads and handles 204', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ lessonId: 'l1', videoStatus: 'PENDING' }, 202))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const api = createApi({ fetchImpl });
    await api.uploadVideo('l1', new File(['x'], 'v.mp4', { type: 'video/mp4' }));
    const init = fetchImpl.mock.calls[0][1];
    expect(init.body).toBeInstanceOf(FormData);
    expect(new Headers(init.headers).has('Content-Type')).toBe(false);
    await expect(api.deleteLesson('l1')).resolves.toBeUndefined();
  });
});
