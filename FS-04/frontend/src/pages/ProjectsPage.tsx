import { type FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../api/client';
import { ErrorBanner, Loading } from '../components/Feedback';
import { useAuth } from '../context/AuthContext';
import { errorMessage, useAsync } from '../lib/useAsync';

export function ProjectsPage() {
  const { can } = useAuth();
  const { data, error, loading, reload } = useAsync(() => api.listProjects(), []);
  const [form, setForm] = useState({ key: '', name: '', description: '' });
  const [formError, setFormError] = useState<string | null>(null);
  const [limitHit, setLimitHit] = useState(false);

  async function create(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setLimitHit(false);
    try {
      await api.createProject({ key: form.key, name: form.name, description: form.description || undefined });
      setForm({ key: '', name: '', description: '' });
      await reload();
    } catch (err) {
      setFormError(errorMessage(err));
      setLimitHit(err instanceof ApiError && err.code === 'PLAN_LIMIT_EXCEEDED');
    }
  }

  return (
    <div>
      <h1>Projects</h1>
      <Loading loading={loading && !data} error={error}>
        <div className="grid">
          {data?.items.map((p) => (
            <div className="card" key={p.id}>
              <h3>
                <span className="badge">{p.key}</span> {p.name}
              </h3>
              <p className="muted">{p.description ?? 'No description'}</p>
              <p className="muted">{p._count?.issues ?? 0} issues</p>
              <div className="row">
                <Link className="btn btn-primary" to={`/projects/${p.id}/board`}>
                  Board
                </Link>
                <Link className="btn" to={`/projects/${p.id}/sprints`}>
                  Sprints &amp; backlog
                </Link>
              </div>
            </div>
          ))}
          {data?.items.length === 0 && <p className="muted">No projects yet.</p>}
        </div>
      </Loading>

      {can('project:write') && (
        <form className="card form-inline" onSubmit={create}>
          <h3>New project</h3>
          <ErrorBanner message={formError} />
          {limitHit && (
            <p>
              <Link to="/billing">Upgrade your plan</Link> to add more projects.
            </p>
          )}
          <div className="row">
            <input
              placeholder="KEY"
              value={form.key}
              onChange={(e) => setForm({ ...form, key: e.target.value.toUpperCase() })}
              required
              pattern="[A-Za-z][A-Za-z0-9]{1,9}"
              title="2-10 letters/digits, starting with a letter"
              style={{ width: 90 }}
            />
            <input placeholder="Project name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <input placeholder="Description (optional)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <button className="btn btn-primary">Create</button>
          </div>
        </form>
      )}
    </div>
  );
}
