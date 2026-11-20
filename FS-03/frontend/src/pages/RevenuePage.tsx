import { RevenueCharts } from '../components/RevenueCharts';
import { api } from '../api/client';
import { formatDateTime, formatRevenue } from '../lib/format';
import { useAsync } from '../lib/useAsync';

export function RevenuePage() {
  const summary = useAsync(() => api.revenueSummary(), []);
  const payouts = useAsync(() => api.payouts(), []);

  return (
    <div>
      <h1>Revenue</h1>
      {summary.error && <p className="error">{summary.error}</p>}
      {summary.data && (
        <>
          <div className="grid-3">
            <div className="card stat">
              <span className="muted">Total earnings</span>
              <strong>{formatRevenue(summary.data.totalCents)}</strong>
            </div>
            <div className="card stat">
              <span className="muted">Last 30 days</span>
              <strong>{formatRevenue(summary.data.last30DaysCents)}</strong>
            </div>
            <div className="card stat">
              <span className="muted">Pending payout balance</span>
              <strong>{formatRevenue(payouts.data?.pendingBalanceCents ?? 0)}</strong>
            </div>
          </div>
          <RevenueCharts summary={summary.data} />

          <h2>Per course</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Course</th>
                <th>Sales</th>
                <th>Earnings</th>
              </tr>
            </thead>
            <tbody>
              {summary.data.perCourse.map((c) => (
                <tr key={c.courseId}>
                  <td>{c.title}</td>
                  <td>{c.sales}</td>
                  <td>{formatRevenue(c.totalCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h2>Payouts</h2>
      {payouts.data?.items.length === 0 && <p className="muted">No payouts yet.</p>}
      <ul className="list card">
        {payouts.data?.items.map((p) => (
          <li key={p.id} className="row between">
            <span>{formatDateTime(p.createdAt)}</span>
            <span>
              {formatRevenue(p.amountCents)} <span className={`badge ${p.status === 'PAID' ? 'ok' : 'warn'}`}>{p.status}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
