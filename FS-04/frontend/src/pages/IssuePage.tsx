import { type ChangeEvent, type FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { ISSUE_PRIORITIES, ISSUE_TYPES, type Issue, type IssuePriority, type IssueType } from '../api/types';
import { ErrorBanner, Loading } from '../components/Feedback';
import { useAuth } from '../context/AuthContext';
import { downloadBlob, formatBytes, formatDateTime } from '../lib/format';
import { errorMessage, useAsync } from '../lib/useAsync';

function IssueFields({ issue, onSaved }: { issue: Issue; onSaved: () => void }) {
  const { can } = useAuth();
  const canWrite = can('issue:write');
  const members = useAsync(() => api.members(), []);
  const [draft, setDraft] = useState({
    title: issue.title,
    description: issue.description ?? '',
    type: issue.type,
    priority: issue.priority,
    storyPoints: issue.storyPoints === null ? '' : String(issue.storyPoints),
    assigneeId: issue.assigneeId ?? '',
  });
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.updateIssue(issue.id, {
        title: draft.title,
        description: draft.description || null,
        type: draft.type,
        priority: draft.priority,
        storyPoints: draft.storyPoints === '' ? null : Number(draft.storyPoints),
        assigneeId: draft.assigneeId || null,
      });
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <form className="card stack" onSubmit={save}>
      <ErrorBanner message={error} />
      <label>
        Title
        <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} required disabled={!canWrite} />
      </label>
      <label>
        Description
        <textarea rows={5} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} disabled={!canWrite} />
      </label>
      <div className="row">
        <label>
          Type
          <select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as IssueType })} disabled={!canWrite}>
            {ISSUE_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label>
          Priority
          <select value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value as IssuePriority })} disabled={!canWrite}>
            {ISSUE_PRIORITIES.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <label>
          Story points
          <input type="number" min={0} max={1000} value={draft.storyPoints} onChange={(e) => setDraft({ ...draft, storyPoints: e.target.value })} disabled={!canWrite} style={{ width: 90 }} />
        </label>
        <label>
          Assignee
          <select value={draft.assigneeId} onChange={(e) => setDraft({ ...draft, assigneeId: e.target.value })} disabled={!canWrite}>
            <option value="">Unassigned</option>
            {members.data?.items.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {canWrite && <button className="btn btn-primary">Save changes</button>}
    </form>
  );
}

function Comments({ issueId }: { issueId: string }) {
  const { session, can } = useAuth();
  const { data, error, reload } = useAsync(() => api.comments(issueId), [issueId]);
  const [body, setBody] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  async function add(e: FormEvent) {
    e.preventDefault();
    setActionError(null);
    try {
      await api.addComment(issueId, body);
      setBody('');
      await reload();
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  async function remove(id: string) {
    setActionError(null);
    try {
      await api.deleteComment(id);
      await reload();
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  return (
    <section className="card stack">
      <h3>Comments</h3>
      <ErrorBanner message={error ?? actionError} />
      {data?.items.length === 0 && <p className="muted">No comments yet.</p>}
      {data?.items.map((c) => (
        <div className="comment" key={c.id}>
          <div className="muted">
            <strong>{c.author.name}</strong> · {formatDateTime(c.createdAt)}
            {(c.author.id === session?.user.id || can('issue:delete')) && (
              <button className="btn-link" onClick={() => void remove(c.id)}>
                Delete
              </button>
            )}
          </div>
          <p className="pre">{c.body}</p>
        </div>
      ))}
      {can('comment:write') && (
        <form className="stack" onSubmit={add}>
          <textarea rows={3} placeholder="Add a comment" value={body} onChange={(e) => setBody(e.target.value)} required />
          <button className="btn btn-primary">Comment</button>
        </form>
      )}
    </section>
  );
}

function Attachments({ issueId }: { issueId: string }) {
  const { can } = useAuth();
  const { data, error, reload } = useAsync(() => api.attachments(issueId), [issueId]);
  const [actionError, setActionError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function upload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setActionError(null);
    try {
      await api.uploadAttachment(issueId, file);
      await reload();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      if (input.current) input.current.value = '';
    }
  }

  async function download(id: string, filename: string) {
    setActionError(null);
    try {
      downloadBlob(await api.downloadAttachment(id), filename);
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  async function remove(id: string) {
    setActionError(null);
    try {
      await api.deleteAttachment(id);
      await reload();
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  return (
    <section className="card stack">
      <h3>Attachments</h3>
      <ErrorBanner message={error ?? actionError} />
      {data?.items.length === 0 && <p className="muted">No attachments.</p>}
      <ul className="list">
        {data?.items.map((a) => (
          <li key={a.id}>
            <button className="btn-link" onClick={() => void download(a.id, a.filename)}>
              {a.filename}
            </button>{' '}
            <span className="muted">
              {formatBytes(a.size)} · {a.uploader.name} · {formatDateTime(a.createdAt)}
            </span>
            {can('attachment:write') && (
              <button className="btn-link" onClick={() => void remove(a.id)}>
                Delete
              </button>
            )}
          </li>
        ))}
      </ul>
      {can('attachment:write') && (
        <label>
          Upload a file (png, jpg, gif, webp, pdf, txt, csv, json, zip)
          <input ref={input} type="file" onChange={(e) => void upload(e)} />
        </label>
      )}
    </section>
  );
}

function Activity({ issueId }: { issueId: string }) {
  const { data } = useAsync(() => api.issueActivity(issueId), [issueId]);
  return (
    <section className="card">
      <h3>Activity</h3>
      <ul className="list">
        {data?.items.map((a) => (
          <li key={a.id}>
            <strong>{a.actor?.name ?? 'System'}</strong> {a.action} <span className="muted">· {formatDateTime(a.createdAt)}</span>
          </li>
        ))}
        {data?.items.length === 0 && <li className="muted">No activity.</li>}
      </ul>
    </section>
  );
}

export function IssuePage() {
  const { key = '' } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { data, error, loading, reload } = useAsync(async () => {
    const issue = await api.getIssue(key);
    const board = await api.getBoard(issue.boardId);
    return { issue, board };
  }, [key]);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusId, setStatusId] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (data) setStatusId(data.issue.statusId);
  }, [data]);

  async function changeStatus(toColumnId: string) {
    if (!data) return;
    setStatusError(null);
    setStatusId(toColumnId);
    try {
      await api.moveIssue(data.issue.id, toColumnId);
      await reload();
    } catch (err) {
      setStatusId(data.issue.statusId);
      setStatusError(errorMessage(err));
    }
  }

  async function remove() {
    if (!data || !window.confirm(`Delete ${data.issue.key}?`)) return;
    try {
      await api.deleteIssue(data.issue.id);
      navigate(`/projects/${data.issue.projectId}/board`);
    } catch (err) {
      setDeleteError(errorMessage(err));
    }
  }

  return (
    <Loading loading={loading && !data} error={error}>
      {data && (
        <div>
          <p>
            <Link to={`/projects/${data.issue.projectId}/board`}>← Back to board</Link>
          </p>
          <div className="page-head">
            <h1>
              <span className="badge">{data.issue.key}</span> {data.issue.title}
            </h1>
            {can('issue:delete') && (
              <button className="btn btn-danger" onClick={() => void remove()}>
                Delete issue
              </button>
            )}
          </div>
          <ErrorBanner message={deleteError} />
          <div className="card stack">
            <label>
              Status (board workflow)
              <select value={statusId} onChange={(e) => void changeStatus(e.target.value)} disabled={!can('issue:write')}>
                {data.board.columns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <ErrorBanner message={statusError} onDismiss={() => setStatusError(null)} />
            <p className="muted">
              Reporter: {data.issue.reporter.name} · Created {formatDateTime(data.issue.createdAt)}
            </p>
          </div>
          <IssueFields key={`fields-${data.issue.updatedAt}`} issue={data.issue} onSaved={() => void reload()} />
          <Comments issueId={data.issue.id} />
          <Attachments issueId={data.issue.id} />
          <Activity key={`activity-${data.issue.updatedAt}`} issueId={data.issue.id} />
        </div>
      )}
    </Loading>
  );
}
