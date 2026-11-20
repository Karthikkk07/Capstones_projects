import { useState } from 'react';
import { api } from '../api/client';
import type { Plan } from '../api/types';
import { ErrorBanner, Loading } from '../components/Feedback';
import { useAuth } from '../context/AuthContext';
import { formatDate, formatLimit } from '../lib/format';
import { errorMessage, useAsync } from '../lib/useAsync';

function Usage({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const pct = limit === null ? 0 : Math.min(100, Math.round((used / limit) * 100));
  return (
    <div>
      <div className="row between">
        <span>{label}</span>
        <span className="muted">
          {used} / {formatLimit(limit)}
        </span>
      </div>
      <div className="meter" role="progressbar" aria-label={label} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className={`meter-fill${pct >= 100 ? ' full' : ''}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function BillingPage() {
  const { can } = useAuth();
  const { data, error, loading } = useAsync(() => api.billing(), []);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function redirectTo(fn: () => Promise<{ url: string | null }>) {
    setBusy(true);
    setActionError(null);
    try {
      const { url } = await fn();
      if (!url) throw new Error('Stripe did not return a redirect URL');
      window.location.assign(url);
    } catch (err) {
      setActionError(errorMessage(err));
      setBusy(false);
    }
  }

  const canManage = can('billing:manage');
  return (
    <div>
      <h1>Billing</h1>
      <Loading loading={loading && !data} error={error}>
        {data && (
          <>
            <ErrorBanner message={actionError} onDismiss={() => setActionError(null)} />
            {!data.stripeConfigured && <p className="muted">Stripe is not configured on this server, so checkout and the billing portal are unavailable.</p>}
            <section className="card stack">
              <h3>
                Current plan: {data.plans.find((p) => p.id === data.plan)?.name ?? data.plan} <span className="badge">{data.status}</span>
              </h3>
              {data.currentPeriodEnd && <p className="muted">Renews / ends {formatDate(data.currentPeriodEnd)}</p>}
              <Usage label="Projects" used={data.usage.projects} limit={data.limits.projects} />
              <Usage label="Members" used={data.usage.members} limit={data.limits.members} />
              {canManage && data.hasBillingAccount && (
                <div>
                  <button className="btn" disabled={busy} onClick={() => void redirectTo(() => api.portal())}>
                    Manage billing in Stripe
                  </button>
                </div>
              )}
            </section>

            <div className="grid">
              {data.plans.map((p) => (
                <div className={`card${p.id === data.plan ? ' current' : ''}`} key={p.id}>
                  <h3>{p.name}</h3>
                  <p className="price">{p.price}</p>
                  <ul className="list">
                    <li>{formatLimit(p.maxProjects)} projects</li>
                    <li>{formatLimit(p.maxMembers)} members</li>
                  </ul>
                  {p.id === data.plan ? (
                    <span className="badge">Current plan</span>
                  ) : (
                    p.id !== 'FREE' &&
                    canManage && (
                      <button className="btn btn-primary" disabled={busy || !data.stripeConfigured} onClick={() => void redirectTo(() => api.checkout(p.id as Exclude<Plan, 'FREE'>))}>
                        Upgrade to {p.name}
                      </button>
                    )
                  )}
                </div>
              ))}
            </div>
            {!canManage && <p className="muted">Only the workspace owner can change the plan.</p>}
          </>
        )}
      </Loading>
    </div>
  );
}
