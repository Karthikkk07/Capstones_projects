import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { formatDateTime, formatDuration, formatMoney } from '../lib/format';
import { errorMessage, useAsync } from '../lib/useAsync';

export function CourseDetailPage() {
  const { slug = '' } = useParams();
  const [params] = useSearchParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const course = useAsync(() => api.getCourse(slug), [slug, user?.id]);
  const live = useAsync(
    async () => (course.data?.enrolled || course.data?.canManage ? (await api.liveClasses(course.data.id)).items : []),
    [course.data?.id, course.data?.enrolled],
  );

  async function enroll() {
    if (!user || !course.data) return navigate('/login', { state: { from: `/courses/${slug}` } });
    setBusy(true);
    setError(null);
    try {
      if (course.data.priceCents > 0) {
        const { url } = await api.checkout(course.data.id);
        if (url) window.location.href = url;
        return;
      }
      await api.enroll(course.data.id);
      await course.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (course.loading && !course.data) return <p className="muted">Loading…</p>;
  if (course.error || !course.data) return <p className="error">{course.error ?? 'Course not found'}</p>;
  const c = course.data;
  const firstLesson = c.sections[0]?.lessons[0];

  return (
    <div className="grid-main">
      <div>
        <span className="badge">{c.category}</span>
        {c.status === 'DRAFT' && <span className="badge warn">Draft</span>}
        <h1>{c.title}</h1>
        <p className="muted">Taught by {c.instructor?.name}</p>
        <p className="prewrap">{c.description}</p>

        {params.get('payment') === 'success' && !c.enrolled && (
          <p className="info">Payment received - your enrollment will be active in a moment. Refresh shortly.</p>
        )}

        <h2>Curriculum</h2>
        {c.sections.map((s) => (
          <section key={s.id} className="card">
            <h4>{s.title}</h4>
            <ul className="list">
              {s.lessons.map((l) => (
                <li key={l.id} className="row between">
                  <span>
                    {l.type === 'VIDEO' ? '▶' : '📄'} {l.title}
                  </span>
                  <span className="muted">{formatDuration(l.durationSec)}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {c.quizzes.length > 0 && <p className="muted">Includes {c.quizzes.length} quiz(zes).</p>}

        {(c.enrolled || c.canManage) && live.data && live.data.length > 0 && (
          <>
            <h2>Live classes</h2>
            <ul className="list card">
              {live.data.map((lc) => (
                <li key={lc.id} className="row between">
                  <span>
                    {lc.title} · {formatDateTime(lc.scheduledAt)} <span className="badge">{lc.status}</span>
                  </span>
                  {lc.status !== 'ENDED' && (
                    <Link className="btn btn-small" to={`/live/${lc.id}`}>
                      {lc.status === 'LIVE' ? 'Join now' : 'Open room'}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <aside className="card sticky">
        <img src={c.thumbnail ?? `https://picsum.photos/seed/${c.slug}/640/360`} alt="" />
        <h2>{formatMoney(c.priceCents)}</h2>
        {error && <p className="error">{error}</p>}
        {c.enrolled ? (
          <Link className="btn block" to={firstLesson ? `/learn/${c.id}` : '#'}>
            Continue learning
          </Link>
        ) : c.canManage ? (
          <Link className="btn block" to={`/instructor/courses/${c.id}`}>
            Manage course
          </Link>
        ) : (
          <button className="btn block" onClick={enroll} disabled={busy}>
            {c.priceCents > 0 ? 'Buy with Stripe' : 'Enroll for free'}
          </button>
        )}
      </aside>
    </div>
  );
}
