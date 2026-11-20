import { type FormEvent, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import type { Issue, Sprint, SprintReport } from '../api/types';
import { ErrorBanner, Loading } from '../components/Feedback';
import { useAuth } from '../context/AuthContext';
import { formatDate } from '../lib/format';
import { errorMessage, useAsync } from '../lib/useAsync';

function IssueRow({ issue, sprints, canWrite, onAssign }: { issue: Issue; sprints: Sprint[]; canWrite: boolean; onAssign: (id: string, sprintId: string | null) => void }) {
  const open = sprints.filter((s) => s.state !== 'COMPLETED');
  return (
    <li className="issue-row">
      <Link to={`/issues/${issue.key}`}>
        <span className="badge">{issue.key}</span> {issue.title}
      </Link>
      <span className="muted">
        {issue.status.name}
        {issue.storyPoints !== null && ` · ${issue.storyPoints} pts`}
      </span>
      {canWrite && (
        <select aria-label={`Sprint for ${issue.key}`} value={issue.sprintId ?? ''} onChange={(e) => onAssign(issue.id, e.target.value || null)}>
          <option value="">Backlog</option>
          {open.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      )}
    </li>
  );
}

export function SprintsPage() {
  const { projectId = '' } = useParams();
  const { can } = useAuth();
  const canManage = can('sprint:write');
  const { data, error, loading, reload } = useAsync(async () => {
    const [project, sprints, issues] = await Promise.all([api.getProject(projectId), api.sprints(projectId), api.listIssues({ projectId })]);
    return { project, sprints: sprints.items, issues: issues.items };
  }, [projectId]);
  const [form, setForm] = useState({ name: '', goal: '', startDate: '', endDate: '' });
  const [actionError, setActionError] = useState<string | null>(null);
  const [moveTo, setMoveTo] = useState<Record<string, string>>({});
  const [report, setReport] = useState<{ report: SprintReport; moved: number } | null>(null);

  async function run(fn: () => Promise<unknown>) {
    setActionError(null);
    try {
      await fn();
      await reload();
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  const create = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api.createSprint(projectId, {
        name: form.name,
        goal: form.goal || undefined,
        startDate: form.startDate || undefined,
        endDate: form.endDate || undefined,
      });
      setForm({ name: '', goal: '', startDate: '', endDate: '' });
    });
  };

  const complete = (s: Sprint) =>
    void run(async () => {
      const res = await api.completeSprint(s.id, moveTo[s.id]);
      setReport({ report: res.report, moved: res.movedIssues });
    });

  const sprints = data?.sprints ?? [];
  const issues = data?.issues ?? [];
  const backlog = issues.filter((i) => !i.sprintId);
  const assign = (id: string, sprintId: string | null) => void run(() => api.setIssueSprint(id, sprintId));

  return (
    <div>
      <Loading loading={loading && !data} error={error}>
        <p>
          <Link to={`/projects/${projectId}/board`}>← Board</Link>
        </p>
        <h1>
          <span className="badge">{data?.project.key}</span> Sprints &amp; backlog
        </h1>
        <ErrorBanner message={actionError} onDismiss={() => setActionError(null)} />

        {report && (
          <div className="card">
            <h3>Sprint "{report.report.sprint.name}" completed</h3>
            <p>
              {report.report.totals.completedIssues}/{report.report.totals.issues} issues done ({report.report.totals.completionPercent}%) ·{' '}
              {report.report.totals.completedPoints}/{report.report.totals.points} points · {report.moved} unfinished issue(s) moved.
            </p>
            <button className="btn-link" onClick={() => setReport(null)}>
              Dismiss
            </button>
          </div>
        )}

        {canManage && (
          <form className="card form-inline" onSubmit={create}>
            <h3>New sprint</h3>
            <div className="row">
              <input placeholder="Sprint name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              <input placeholder="Goal (optional)" value={form.goal} onChange={(e) => setForm({ ...form, goal: e.target.value })} />
              <input type="date" aria-label="Start date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
              <input type="date" aria-label="End date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
              <button className="btn btn-primary">Create sprint</button>
            </div>
          </form>
        )}

        {sprints.map((s) => {
          const planned = sprints.filter((o) => o.state === 'PLANNED' && o.id !== s.id);
          return (
            <section className="card" key={s.id}>
              <div className="page-head">
                <h3>
                  {s.name} <span className={`badge state-${s.state}`}>{s.state}</span>
                </h3>
                {canManage && s.state === 'PLANNED' && (
                  <button className="btn btn-primary" onClick={() => void run(() => api.startSprint(s.id))}>
                    Start sprint
                  </button>
                )}
                {canManage && s.state === 'ACTIVE' && (
                  <div className="row">
                    <select aria-label="Move unfinished issues to" value={moveTo[s.id] ?? ''} onChange={(e) => setMoveTo({ ...moveTo, [s.id]: e.target.value })}>
                      <option value="">Unfinished → backlog</option>
                      {planned.map((p) => (
                        <option key={p.id} value={p.id}>
                          Unfinished → {p.name}
                        </option>
                      ))}
                    </select>
                    <button className="btn" onClick={() => complete(s)}>
                      Complete sprint
                    </button>
                  </div>
                )}
              </div>
              <p className="muted">
                {s.goal ?? 'No goal'} · {formatDate(s.startDate)} – {formatDate(s.endDate)}
              </p>
              <ul className="list">
                {issues
                  .filter((i) => i.sprintId === s.id)
                  .map((i) => (
                    <IssueRow key={i.id} issue={i} sprints={sprints} canWrite={can('issue:write') && s.state !== 'COMPLETED'} onAssign={assign} />
                  ))}
              </ul>
            </section>
          );
        })}

        <section className="card">
          <h3>
            Backlog <span className="muted">({backlog.length})</span>
          </h3>
          <ul className="list">
            {backlog.map((i) => (
              <IssueRow key={i.id} issue={i} sprints={sprints} canWrite={can('issue:write')} onAssign={assign} />
            ))}
            {backlog.length === 0 && <li className="muted">The backlog is empty.</li>}
          </ul>
        </section>
      </Loading>
    </div>
  );
}
