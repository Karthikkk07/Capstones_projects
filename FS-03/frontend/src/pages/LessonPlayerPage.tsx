import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import type { Certificate, CourseProgress, Lesson, Playback } from '../api/types';
import { HlsPlayer } from '../components/HlsPlayer';
import { ProgressBar } from '../components/ProgressBar';
import { errorMessage, useAsync } from '../lib/useAsync';

export function LessonPlayerPage() {
  const { courseId = '', lessonId } = useParams();
  const navigate = useNavigate();
  const [progress, setProgress] = useState<CourseProgress | null>(null);
  const [certificate, setCertificate] = useState<Certificate | null>(null);
  const [error, setError] = useState<string | null>(null);

  const course = useAsync(() => api.getCourse(courseId), [courseId]);
  const quizzes = useAsync(() => api.listQuizzes(courseId), [courseId]);

  useEffect(() => {
    api.courseProgress(courseId).then(setProgress).catch((e) => setError(errorMessage(e)));
  }, [courseId]);

  const orderedLessons = course.data?.sections.flatMap((s) => s.lessons) ?? [];
  const activeId = lessonId ?? progress?.resumeLessonId ?? orderedLessons[0]?.id;

  const lesson = useAsync<{ lesson: Lesson; playback: Playback | null; playbackError?: string } | null>(async () => {
    if (!activeId) return null;
    const l = await api.getLesson(activeId);
    if (l.type !== 'VIDEO') return { lesson: l, playback: null };
    try {
      return { lesson: l, playback: await api.playback(activeId) };
    } catch (e) {
      return { lesson: l, playback: null, playbackError: errorMessage(e) };
    }
  }, [activeId]);

  const done = new Set(progress?.lessons?.filter((l) => l.completed).map((l) => l.lessonId));

  async function save(data: { positionSec?: number; completed?: boolean }) {
    if (!activeId) return;
    try {
      const res = await api.saveProgress(activeId, data);
      setProgress(res.course);
      if (res.certificate) setCertificate(res.certificate);
      return res;
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function complete() {
    await save({ completed: true });
    const idx = orderedLessons.findIndex((l) => l.id === activeId);
    const next = orderedLessons[idx + 1];
    if (next) navigate(`/learn/${courseId}/${next.id}`);
  }

  if (course.loading && !course.data) return <p className="muted">Loading…</p>;
  if (course.error || !course.data) return <p className="error">{course.error ?? 'Not found'}</p>;
  const current = lesson.data?.lesson;

  return (
    <div className="learn">
      <aside className="card learn-side">
        <Link to={`/courses/${course.data.slug}`}>← {course.data.title}</Link>
        <ProgressBar percent={progress?.percent ?? 0} />
        {course.data.sections.map((s) => (
          <div key={s.id}>
            <h4>{s.title}</h4>
            <ul className="list">
              {s.lessons.map((l) => (
                <li key={l.id} className={l.id === activeId ? 'active' : ''}>
                  <Link to={`/learn/${courseId}/${l.id}`}>
                    {done.has(l.id) ? '✅' : l.type === 'VIDEO' ? '▶' : '📄'} {l.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {(quizzes.data?.items.length ?? 0) > 0 && <h4>Quizzes</h4>}
        <ul className="list">
          {quizzes.data?.items.map((q) => (
            <li key={q.id}>
              <Link to={`/quiz/${q.id}`}>
                {q.passed ? '✅' : '📝'} {q.title}
              </Link>
            </li>
          ))}
        </ul>
      </aside>

      <section className="learn-main">
        {error && <p className="error">{error}</p>}
        {certificate && (
          <p className="info">
            🎉 Course complete! Your certificate <strong>{certificate.code}</strong> is ready on <Link to="/dashboard">your dashboard</Link>.
          </p>
        )}
        {lesson.loading && <p className="muted">Loading lesson…</p>}
        {current && (
          <>
            <h2>{current.title}</h2>
            {current.type === 'VIDEO' ? (
              lesson.data?.playback ? (
                <HlsPlayer
                  key={current.id}
                  src={lesson.data.playback.url}
                  startAt={current.progress?.positionSec ?? 0}
                  onTimeSave={(positionSec) => void save({ positionSec })}
                  onEnded={() => void save({ completed: true })}
                />
              ) : (
                <p className="info">{lesson.data?.playbackError ?? 'Video is not available yet.'}</p>
              )
            ) : (
              <article className="card prewrap">{current.content}</article>
            )}
            <div className="row">
              <button className="btn" onClick={complete} disabled={done.has(current.id)}>
                {done.has(current.id) ? 'Completed ✓' : 'Mark complete & continue'}
              </button>
            </div>
          </>
        )}
        {!lesson.loading && !current && <p className="muted">This course has no lessons yet.</p>}
      </section>
    </div>
  );
}
