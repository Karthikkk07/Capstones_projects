import type {
  ActivityEntry,
  Attachment,
  AuditLogEntry,
  AuthResponse,
  BillingInfo,
  Board,
  Comment,
  Issue,
  IssuePriority,
  IssueType,
  Member,
  Plan,
  Project,
  Sprint,
  SprintReport,
  Webhook,
  WorkflowTransition,
} from './types';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public details?: unknown,
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

interface ErrorBody {
  error?: { code?: string; message?: string; details?: unknown } | string;
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
      const body = (await res.json().catch(() => undefined)) as ErrorBody | undefined;
      if (res.status === 401 && token) opts.onUnauthorized?.();
      const err = body?.error;
      if (typeof err === 'string') throw new ApiError(res.status, err);
      throw new ApiError(res.status, err?.message ?? res.statusText, err?.code, err?.details);
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
    register: (data: { email: string; password: string; name: string; workspaceName: string }) => post<AuthResponse>('/auth/register', data),
    login: (data: { email: string; password: string }) => post<AuthResponse>('/auth/login', data),

    // workspace
    members: () => get<{ items: Member[] }>('/workspace/members'),

    // projects & boards
    listProjects: () => get<{ items: Project[] }>('/projects'),
    createProject: (data: { key: string; name: string; description?: string }) => post<Project>('/projects', data),
    getProject: (id: string) => get<Project>(`/projects/${id}`),
    projectBoards: (projectId: string) => get<{ items: Board[] }>(`/projects/${projectId}/boards`),
    getBoard: (id: string) => get<Board>(`/boards/${id}`),
    setTransitions: (boardId: string, transitions: { fromColumnId: string; toColumnId: string }[]) =>
      put<{ items: WorkflowTransition[]; restricted: boolean }>(`/boards/${boardId}/transitions`, { transitions }),

    // issues
    listIssues: (q: { projectId?: string; boardId?: string; sprintId?: string; q?: string; limit?: number }) =>
      get<{ items: Issue[]; total: number }>('/issues', { limit: 500, ...q }),
    createIssue: (data: {
      projectId: string;
      boardId?: string;
      statusId?: string;
      title: string;
      description?: string;
      type?: IssueType;
      priority?: IssuePriority;
      storyPoints?: number | null;
    }) => post<Issue>('/issues', data),
    getIssue: (idOrKey: string) => get<Issue>(`/issues/${idOrKey}`),
    updateIssue: (
      id: string,
      data: Partial<{
        title: string;
        description: string | null;
        type: IssueType;
        priority: IssuePriority;
        assigneeId: string | null;
        storyPoints: number | null;
      }>,
    ) => patch<Issue>(`/issues/${id}`, data),
    deleteIssue: (id: string) => del<void>(`/issues/${id}`),
    moveIssue: (id: string, toColumnId: string, position?: number) => post<Issue>(`/issues/${id}/move`, { toColumnId, position }),
    setIssueSprint: (id: string, sprintId: string | null) => put<Issue>(`/issues/${id}/sprint`, { sprintId }),
    issueActivity: (id: string) => get<{ items: ActivityEntry[] }>(`/issues/${id}/activity`),

    // comments & attachments
    comments: (issueId: string) => get<{ items: Comment[] }>(`/issues/${issueId}/comments`),
    addComment: (issueId: string, body: string) => post<Comment>(`/issues/${issueId}/comments`, { body }),
    deleteComment: (id: string) => del<void>(`/comments/${id}`),
    attachments: (issueId: string) => get<{ items: Attachment[] }>(`/issues/${issueId}/attachments`),
    uploadAttachment: async (issueId: string, file: File) => {
      const form = new FormData();
      form.append('file', file);
      return (await raw(`/issues/${issueId}/attachments`, { method: 'POST', body: form })).json() as Promise<Attachment>;
    },
    downloadAttachment: async (id: string): Promise<Blob> => (await raw(`/attachments/${id}/download`)).blob(),
    deleteAttachment: (id: string) => del<void>(`/attachments/${id}`),

    // sprints
    sprints: (projectId: string) => get<{ items: Sprint[] }>(`/projects/${projectId}/sprints`),
    createSprint: (projectId: string, data: { name: string; goal?: string; startDate?: string; endDate?: string }) =>
      post<Sprint>(`/projects/${projectId}/sprints`, data),
    startSprint: (id: string) => post<Sprint>(`/sprints/${id}/start`),
    completeSprint: (id: string, moveIncompleteTo?: string | null) =>
      post<{ sprint: Sprint; movedIssues: number; report: SprintReport }>(`/sprints/${id}/complete`, { moveIncompleteTo: moveIncompleteTo || undefined }),
    sprintReport: (id: string) => get<SprintReport>(`/reports/sprints/${id}`),

    // audit
    auditLogs: (q: { entity?: string; action?: string; limit?: number; offset?: number }) =>
      get<{ items: AuditLogEntry[]; total: number }>('/audit-logs', q),

    // webhooks
    webhookEvents: () => get<{ events: string[] }>('/webhooks/events'),
    webhooks: () => get<{ items: Webhook[] }>('/webhooks'),
    createWebhook: (data: { url: string; events: string[]; active?: boolean }) => post<Webhook>('/webhooks', data),
    updateWebhook: (id: string, data: Partial<{ url: string; events: string[]; active: boolean }>) => patch<Webhook>(`/webhooks/${id}`, data),
    deleteWebhook: (id: string) => del<void>(`/webhooks/${id}`),

    // billing
    billing: () => get<BillingInfo>('/billing'),
    checkout: (plan: Exclude<Plan, 'FREE'>) => post<{ id: string; url: string | null }>('/billing/checkout', { plan }),
    portal: () => post<{ url: string }>('/billing/portal'),
  };
}

export type Api = ReturnType<typeof createApi>;

export const TOKEN_KEY = 'pm.token';
export const SESSION_KEY = 'pm.session';

export const api = createApi({
  getToken: () => localStorage.getItem(TOKEN_KEY),
  onUnauthorized: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(SESSION_KEY);
    window.dispatchEvent(new Event('pm:unauthorized'));
  },
});
