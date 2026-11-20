import { useState } from 'react';
import { api } from '../api/client';
import { ErrorBanner } from '../components/Feedback';
import { formatDateTime } from '../lib/format';
import { useAsync } from '../lib/useAsync';

const PAGE_SIZE = 25;
const ENTITIES = ['', 'issue', 'project', 'sprint', 'board', 'webhook', 'membership', 'workspace'];

export function AuditPage() {
  const [entity, setEntity] = useState('');
  const [action, setAction] = useState('');
  const [offset, setOffset] = useState(0);
  const { data, error, loading } = useAsync(() => api.auditLogs({ entity, action, limit: PAGE_SIZE, offset }), [entity, action, offset]);
  const total = data?.total ?? 0;

  return (
    <div>
      <h1>Audit log</h1>
      <div className="row form-inline">
        <select
          aria-label="Entity"
          value={entity}
          onChange={(e) => {
            setEntity(e.target.value);
            setOffset(0);
          }}
        >
          {ENTITIES.map((e) => (
            <option key={e} value={e}>
              {e || 'All entities'}
            </option>
          ))}
        </select>
        <input
          placeholder="Action prefix (e.g. issue.)"
          value={action}
          onChange={(e) => {
            setAction(e.target.value);
            setOffset(0);
          }}
        />
      </div>
      <ErrorBanner message={error} />
      {loading && !data ? (
        <p className="muted">Loading…</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>When</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Entity</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((l) => (
              <tr key={l.id}>
                <td>{formatDateTime(l.createdAt)}</td>
                <td>{l.actor?.name ?? 'System'}</td>
                <td>
                  <code>{l.action}</code>
                </td>
                <td>{l.entity}</td>
                <td className="mono">{l.meta ? JSON.stringify(l.meta) : ''}</td>
              </tr>
            ))}
            {data?.items.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No entries.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
      <div className="row">
        <button className="btn" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
          Previous
        </button>
        <span className="muted">
          {total === 0 ? 0 : offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
        </span>
        <button className="btn" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>
          Next
        </button>
      </div>
    </div>
  );
}
