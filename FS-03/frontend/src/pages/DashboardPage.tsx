import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { ProgressBar } from '../components/ProgressBar';
import { downloadBlob, formatDateTime } from '../lib/format';
import { errorMessage, useAsync } from '../lib/useAsync';

export function DashboardPage() {
  const enrollments = useAsync(() => api.myEnrollments(), []);
  const certificates = useAsync(() => api.myCertificates(), []);
  const live = useAsync(() => api.myLiveClasses(), []);
  const [error, setError] = useState<string | null>(null);

  async function download(id: string, code: string) {
    try {
      downloadBlob(await api.certificatePdf(id), `certificate-${code}.pdf`);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <div>
      <h1>My learning</h1>
      {(enrollments.error || error) && <p className="error">{enrollments.error ?? error}</p>}

      {enrollments.data?.items.length === 0 && (
        <p className="muted">
          You are not enrolled in any course yet. <Link to="/">Browse the catalog</Link>.
        </p>
      )}
      <div className="grid-3">
        {enrollments.data?.items.map((e) => (
          <Link key={e.id} to={`/learn/${e.courseId}`} className="card course-card">
            <img src={e.course.thumbnail ?? `https://picsum.photos/seed/${e.course.slug}/640/360`} alt="" loading="lazy" />
            <h3>{e.course.title}</h3>
            <p className="muted">
              {e.progress.completedLessons}/{e.progress.totalLessons} lessons
            </p>
            <ProgressBar percent={e.progress.percent} label={`Progress in ${e.course.title}`} />
          </Link>
        ))}
      </div>

      <h2>Upcoming live classes</h2>
      {live.data?.items.length === 0 && <p className="muted">Nothing scheduled.</p>}
      <ul className="list card">
        {live.data?.items.map((lc) => (
          <li key={lc.id} className="row between">
            <span>
              <strong>{lc.title}</strong> · {lc.course?.title} · {formatDateTime(lc.scheduledAt)} <span className="badge">{lc.status}</span>
            </span>
            <Link className="btn btn-small" to={`/live/${lc.id}`}>
              {lc.status === 'LIVE' ? 'Join now' : 'Open room'}
            </Link>
          </li>
        ))}
      </ul>

      <h2>Certificates</h2>
      {certificates.data?.items.length === 0 && <p className="muted">Complete a course to earn a certificate.</p>}
      <ul className="list card">
        {certificates.data?.items.map((c) => (
          <li key={c.id} className="row between">
            <span>
              🎓 {c.course.title} <span className="muted">· {c.code} · {new Date(c.issuedAt).toLocaleDateString()}</span>
            </span>
            <button className="btn btn-small" onClick={() => download(c.id, c.code)}>
              Download PDF
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function VerifyCertificatePage({ code }: { code: string }) {
  const result = useAsync(() => api.verifyCertificate(code), [code]);
  return (
    <div className="card narrow">
      <h2>Certificate verification</h2>
      {result.loading && <p className="muted">Checking…</p>}
      {result.error && <p className="error">❌ {result.error}</p>}
      {result.data?.valid && (
        <>
          <p>✅ Valid certificate</p>
          <p>
            <strong>{result.data.studentName}</strong> completed <strong>{result.data.courseTitle}</strong> on{' '}
            {new Date(result.data.issuedAt).toLocaleDateString()}.
          </p>
          <p className="muted">Code: {result.data.code}</p>
        </>
      )}
    </div>
  );
}
