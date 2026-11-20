import { type FormEvent, useState } from 'react';
import { api } from '../api/client';
import { ErrorBanner, Loading } from '../components/Feedback';
import { errorMessage, useAsync } from '../lib/useAsync';

export function WebhooksPage() {
  const hooks = useAsync(() => api.webhooks(), []);
  const events = useAsync(() => api.webhookEvents(), []);
  const [url, setUrl] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newSecret, setNewSecret] = useState<{ url: string; secret: string } | null>(null);

  const toggleEvent = (ev: string) => setSelected((s) => (s.includes(ev) ? s.filter((x) => x !== ev) : [...s, ev]));

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await hooks.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function create(e: FormEvent) {
    e.preventDefault();
    if (selected.length === 0) {
      setError('Select at least one event');
      return;
    }
    void run(async () => {
      const hook = await api.createWebhook({ url, events: selected });
      setNewSecret({ url: hook.url, secret: hook.secret });
      setUrl('');
      setSelected([]);
    });
  }

  return (
    <div>
      <h1>Webhooks</h1>
      <p className="muted">Deliveries are signed with the webhook secret so your endpoint can verify them.</p>
      <ErrorBanner message={error} onDismiss={() => setError(null)} />

      {newSecret && (
        <div className="card notice">
          <strong>Signing secret for {newSecret.url}</strong>
          <p className="mono">{newSecret.secret}</p>
          <p className="muted">Copy it now - it will not be shown again.</p>
          <button className="btn-link" onClick={() => setNewSecret(null)}>
            Dismiss
          </button>
        </div>
      )}

      <form className="card stack" onSubmit={create}>
        <h3>Add endpoint</h3>
        <input type="url" placeholder="https://example.com/hooks" value={url} onChange={(e) => setUrl(e.target.value)} required />
        <div className="row wrap">
          {events.data?.events.map((ev) => (
            <label key={ev} className="check">
              <input type="checkbox" checked={selected.includes(ev)} onChange={() => toggleEvent(ev)} /> {ev}
            </label>
          ))}
        </div>
        <button className="btn btn-primary">Create webhook</button>
      </form>

      <Loading loading={hooks.loading && !hooks.data} error={hooks.error}>
        <table className="table">
          <thead>
            <tr>
              <th>URL</th>
              <th>Events</th>
              <th>Secret</th>
              <th>Active</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {hooks.data?.items.map((h) => (
              <tr key={h.id}>
                <td>{h.url}</td>
                <td>{h.events.join(', ')}</td>
                <td className="mono">{h.secret}</td>
                <td>
                  <input type="checkbox" aria-label={`Active ${h.url}`} checked={h.active} onChange={(e) => void run(() => api.updateWebhook(h.id, { active: e.target.checked }))} />
                </td>
                <td>
                  <button className="btn btn-danger" onClick={() => void run(() => api.deleteWebhook(h.id))}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {hooks.data?.items.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No webhooks configured.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Loading>
    </div>
  );
}
