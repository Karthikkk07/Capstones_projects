import type {
  AttemptResult,
  AuthResponse,
  Certificate,
  CertificateVerification,
  ChatMessage,
  Course,
  CourseDetail,
  CourseProgress,
  Enrollment,
  Lesson,
  LiveClass,
  LiveToken,
  Paged,
  Payout,
  Playback,
  Quiz,
  QuizInput,
  QuizListItem,
  RevenueSummary,
  Role,
  User,
  VideoStatus,
} from './types';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiOptions {
  baseUrl?: string;
  getToken?: () => string | null;
  fetchImpl?: typeof fetch;
  onUnauthorized?: () => void;
}

type Query = Record<string, string | number | boolean | undefined | null>;

export function buildQuery(params?: Query): string {
  if (!params) return '';
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function createApi(opts: ApiOptions = {}) {
  const baseUrl = opts.baseUrl ?? '/api';
  const doFetch = (...args: Parameters<typeof fetch>) => (opts.fetchImpl ?? fetch)(...args);

  async function raw(path: string, init: RequestInit = {}, query?: Query): Promise<Response> {
    const headers = new Headers(init.headers);
    const token = opts.getToken?.();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const res = await doFetch(`${baseUrl}${path}${buildQuery(query)}`, { ...init, headers });
    if (!res.ok) {
      const body = await res.json().catch(() => undefined);
      if (res.status === 401) opts.onUnauthorized?.();
      throw new ApiError(res.status, (body as { error?: string } | undefined)?.error ?? res.statusText, body);
    }
    return res;
  }

  async function request<T>(method: string, path: string, body?: unknown, query?: Query): Promise<T> {
    const res = await raw(path, { method, body: body === undefined ? undefined : JSON.stringify(body) }, query);
    return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  }

  const get = <T>(path: string, query?: Query) => request<T>('GET', path, undefined, query);
  const post = <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {});
  const patch = <T>(path: string, body: unknown) => request<T>('PATCH', path, body);
  const put = <T>(path: string, body: unknown) => request<T>('PUT', path, body);
  const del = <T>(path: string) => request<T>('DELETE', path);

  return {
    // auth
    register: (data: { email: string; password: string; name: string; role: Exclude<Role, 'ADMIN'> }) => post<AuthResponse>('/auth/register', data),
    login: (data: { email: string; password: string }) => post<AuthResponse>('/auth/login', data),
    me: () => get<{ user: User }>('/auth/me'),

    // catalog
    listCourses: (q: { q?: string; category?: string; page?: number; pageSize?: number; sort?: string; free?: boolean }) =>
      get<Paged<Course>>('/courses', q),
    categories: () => get<{ items: { category: string; count: number }[] }>('/courses/categories'),
    getCourse: (idOrSlug: string) => get<CourseDetail>(`/courses/${idOrSlug}`),
    enroll: (courseId: string) => post<{ id: string }>(`/courses/${courseId}/enroll`),
    checkout: (courseId: string) => post<{ sessionId: string; url: string | null }>('/payments/checkout', { courseId }),
    myEnrollments: () => get<{ items: Enrollment[] }>('/me/enrollments'),
    courseProgress: (courseId: string) => get<CourseProgress>(`/courses/${courseId}/progress`),

    // lessons
    getLesson: (id: string) => get<Lesson>(`/lessons/${id}`),
    playback: (id: string) => get<Playback>(`/lessons/${id}/playback`),
    saveProgress: (id: string, data: { positionSec?: number; completed?: boolean }) =>
      post<{ course: CourseProgress; certificate: Certificate | null }>(`/lessons/${id}/progress`, data),

    // quizzes
    listQuizzes: (courseId: string) => get<{ items: QuizListItem[] }>(`/courses/${courseId}/quizzes`),
    getQuiz: (id: string) => get<Quiz>(`/quizzes/${id}`),
    submitQuiz: (id: string, answers: Record<string, string[]>) => post<AttemptResult>(`/quizzes/${id}/attempts`, { answers }),

    // certificates
    myCertificates: () => get<{ items: Certificate[] }>('/certificates'),
    verifyCertificate: (code: string) => get<CertificateVerification>(`/certificates/verify/${encodeURIComponent(code)}`),
    certificatePdf: async (id: string): Promise<Blob> => (await raw(`/certificates/${id}/pdf`)).blob(),

    // live
    liveClasses: (courseId: string) => get<{ items: LiveClass[] }>(`/courses/${courseId}/live-classes`),
    getLiveClass: (id: string) => get<LiveClass>(`/live-classes/${id}`),
    myLiveClasses: () => get<{ items: LiveClass[] }>('/me/live-classes'),
    liveToken: (id: string) => get<LiveToken>(`/live-classes/${id}/token`),
    liveMessages: (id: string) => get<{ items: ChatMessage[] }>(`/live-classes/${id}/messages`),

    // instructor
    instructorCourses: () => get<{ items: Course[] }>('/instructor/courses'),
    createCourse: (data: { title: string; description: string; priceCents: number; category: string }) => post<Course>('/courses', data),
    updateCourse: (id: string, data: Partial<Pick<Course, 'title' | 'description' | 'priceCents' | 'category' | 'thumbnail'>>) =>
      patch<Course>(`/courses/${id}`, data),
    publishCourse: (id: string) => post<Course>(`/courses/${id}/publish`),
    unpublishCourse: (id: string) => post<Course>(`/courses/${id}/unpublish`),
    deleteCourse: (id: string) => del<void>(`/courses/${id}`),
    addSection: (courseId: string, title: string) => post<{ id: string }>(`/courses/${courseId}/sections`, { title }),
    deleteSection: (id: string) => del<void>(`/sections/${id}`),
    addLesson: (sectionId: string, data: { title: string; type: 'VIDEO' | 'TEXT'; content?: string }) => post<{ id: string }>(`/sections/${sectionId}/lessons`, data),
    deleteLesson: (id: string) => del<void>(`/lessons/${id}`),
    uploadVideo: async (lessonId: string, file: File) => {
      const form = new FormData();
      form.append('video', file);
      return (await raw(`/lessons/${lessonId}/video`, { method: 'POST', body: form })).json() as Promise<{ lessonId: string; videoStatus: VideoStatus }>;
    },
    videoStatus: (lessonId: string) => get<{ lessonId: string; videoStatus: VideoStatus; durationSec: number | null }>(`/lessons/${lessonId}/video-status`),
    createQuiz: (courseId: string, data: QuizInput) => post<Quiz>(`/courses/${courseId}/quizzes`, data),
    updateQuiz: (id: string, data: QuizInput) => put<Quiz>(`/quizzes/${id}`, data),
    deleteQuiz: (id: string) => del<void>(`/quizzes/${id}`),
    scheduleLive: (courseId: string, data: { title: string; scheduledAt: string }) => post<LiveClass>(`/courses/${courseId}/live-classes`, data),
    startLive: (id: string) => post<LiveClass>(`/live-classes/${id}/start`),
    endLive: (id: string) => post<LiveClass>(`/live-classes/${id}/end`),
    revenueSummary: () => get<RevenueSummary>('/instructor/revenue/summary'),
    payouts: () => get<{ items: Payout[]; pendingBalanceCents: number }>('/instructor/payouts'),

    // admin
    adminCourses: () => get<{ items: Course[] }>('/admin/courses'),
  };
}

export type Api = ReturnType<typeof createApi>;

export const TOKEN_KEY = 'lms.token';
export const USER_KEY = 'lms.user';

export const api = createApi({
  getToken: () => localStorage.getItem(TOKEN_KEY),
  onUnauthorized: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },
});
