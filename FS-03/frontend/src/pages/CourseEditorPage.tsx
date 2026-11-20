import { type FormEvent, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { QuizBuilder } from '../components/QuizBuilder';
import { VideoUploader } from '../components/VideoUploader';
import { formatDateTime, localInputToIso } from '../lib/format';
import { errorMessage, useAsync } from '../lib/useAsync';

export function CourseEditorPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const course = useAsync(() => api.getCourse(id), [id]);
  const live = useAsync(() => api.liveClasses(id), [id]);
  const [message, setMessage] = useState<{ type: 'error' | 'info'; text: string } | null>(null);
  const [editingQuiz, setEditingQuiz] = useState<string | 'new' | null>(null);
  const [sectionTitle, setSectionTitle] = useState('');
  const [newLesson, setNewLesson] = useState<Record<string, { title: string; type: 'VIDEO' | 'TEXT'; content: string }>>({});
  const [liveForm, setLiveForm] = useState({ title: '', scheduledAt: '' });

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setMessage(null);
    try {
      await fn();
      if (ok) setMessage({ type: 'info', text: ok });
      await course.reload();
    } catch (e) {
      const body = (e as { body?: { details?: { problems?: string[] } } }).body;
      const problems = body?.details?.problems;
      setMessage({ type: 'error', text: problems ? `${errorMessage(e)}: ${problems.join('; ')}` : errorMessage(e) });
    }
  };

  if (course.loading && !course.data) return <p className="muted">Loading…</p>;
  if (course.error || !course.data) return <p className="error">{course.error ?? 'Not found'}</p>;
  const c = course.data;

  async function saveDetails(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await run(
      () =>
        api.updateCourse(c.id, {
          title: String(f.get('title')),
          description: String(f.get('description')),
          category: String(f.get('category')),
          priceCents: Math.round(Number(f.get('price')) * 100),
          thumbnail: String(f.get('thumbnail') ?? '') || null,
        }),
      'Course saved',
    );
  }

  async function addLesson(sectionId: string) {
    const draft = newLesson[sectionId];
    if (!draft?.title) return;
    await run(() => api.addLesson(sectionId, { title: draft.title, type: draft.type, content: draft.type === 'TEXT' ? draft.content : undefined }));
    setNewLesson((s) => ({ ...s, [sectionId]: { title: '', type: 'VIDEO', content: '' } }));
  }

  async function schedule(e: FormEvent) {
    e.preventDefault();
    await run(() => api.scheduleLive(c.id, { title: liveForm.title, scheduledAt: localInputToIso(liveForm.scheduledAt) }), 'Live class scheduled');
    setLiveForm({ title: '', scheduledAt: '' });
    await live.reload();
  }

  return (
    <div>
      <div className="row between">
        <h1>
          {c.title} <span className={`badge ${c.status === 'DRAFT' ? 'warn' : 'ok'}`}>{c.status}</span>
        </h1>
        <div className="row">
          <Link className="btn btn-ghost" to={`/courses/${c.slug}`}>
            Preview
          </Link>
          {c.status === 'DRAFT' ? (
            <button className="btn" onClick={() => run(() => api.publishCourse(c.id), 'Course published')}>
              Publish
            </button>
          ) : (
            <button className="btn btn-ghost" onClick={() => run(() => api.unpublishCourse(c.id), 'Course unpublished')}>
              Unpublish
            </button>
          )}
          <button
            className="btn btn-danger"
            onClick={() => window.confirm('Delete this course?') && run(async () => { await api.deleteCourse(c.id); navigate('/instructor'); })}
          >
            Delete
          </button>
        </div>
      </div>
      {message && <p className={message.type === 'error' ? 'error' : 'info'}>{message.text}</p>}

      <form className="card form" onSubmit={saveDetails} key={c.id + c.title}>
        <h3>Details</h3>
        <label>
          Title
          <input name="title" defaultValue={c.title} required minLength={3} />
        </label>
        <label>
          Description
          <textarea name="description" defaultValue={c.description} rows={4} required />
        </label>
        <div className="row">
          <label>
            Category
            <input name="category" defaultValue={c.category} required />
          </label>
          <label>
            Price (USD)
            <input name="price" type="number" min={0} step="0.01" defaultValue={c.priceCents / 100} />
          </label>
          <label>
            Thumbnail URL
            <input name="thumbnail" type="url" defaultValue={c.thumbnail ?? ''} />
          </label>
        </div>
        <button className="btn">Save details</button>
      </form>

      <h2>Curriculum</h2>
      {c.sections.map((s) => (
        <section key={s.id} className="card">
          <div className="row between">
            <h4>{s.title}</h4>
            <button className="btn btn-ghost btn-small" onClick={() => window.confirm('Delete section and its lessons?') && run(() => api.deleteSection(s.id))}>
              Delete section
            </button>
          </div>
          <ul className="list">
            {s.lessons.map((l) => (
              <li key={l.id} className="lesson-row">
                <div className="row between">
                  <span>
                    {l.type === 'VIDEO' ? '▶' : '📄'} {l.title}
                  </span>
                  <button className="btn btn-ghost btn-small" onClick={() => run(() => api.deleteLesson(l.id))}>
                    Remove
                  </button>
                </div>
                {l.type === 'VIDEO' && <VideoUploader lessonId={l.id} initialStatus={l.videoStatus} onChange={() => void course.reload()} />}
              </li>
            ))}
          </ul>
          <div className="row">
            <input
              placeholder="New lesson title"
              value={newLesson[s.id]?.title ?? ''}
              onChange={(e) => setNewLesson((st) => ({ ...st, [s.id]: { ...(st[s.id] ?? { type: 'VIDEO' as const, content: '' }), title: e.target.value } }))}
            />
            <select
              value={newLesson[s.id]?.type ?? 'VIDEO'}
              aria-label="Lesson type"
              onChange={(e) => setNewLesson((st) => ({ ...st, [s.id]: { ...(st[s.id] ?? { title: '', content: '' }), type: e.target.value as 'VIDEO' | 'TEXT' } }))}
            >
              <option value="VIDEO">Video</option>
              <option value="TEXT">Text</option>
            </select>
            <button className="btn btn-small" onClick={() => addLesson(s.id)}>
              Add lesson
            </button>
          </div>
          {newLesson[s.id]?.type === 'TEXT' && (
            <textarea
              placeholder="Lesson content"
              rows={3}
              value={newLesson[s.id]?.content ?? ''}
              onChange={(e) => setNewLesson((st) => ({ ...st, [s.id]: { ...st[s.id], content: e.target.value } }))}
            />
          )}
        </section>
      ))}
      <div className="row">
        <input placeholder="New section title" value={sectionTitle} onChange={(e) => setSectionTitle(e.target.value)} />
        <button
          className="btn"
          onClick={async () => {
            if (!sectionTitle.trim()) return;
            await run(() => api.addSection(c.id, sectionTitle.trim()));
            setSectionTitle('');
          }}
        >
          Add section
        </button>
      </div>

      <h2>Quizzes</h2>
      <ul className="list card">
        {c.quizzes.length === 0 && <li className="muted">No quizzes yet.</li>}
        {c.quizzes.map((q) => (
          <li key={q.id} className="row between">
            <span>
              📝 {q.title} <span className="muted">· pass {q.passMarkPct}% {q.required ? '· required' : ''}</span>
            </span>
            <span className="row">
              <button className="btn btn-ghost btn-small" onClick={() => setEditingQuiz(q.id)}>
                Edit
              </button>
              <button className="btn btn-ghost btn-small" onClick={() => run(() => api.deleteQuiz(q.id))}>
                Delete
              </button>
            </span>
          </li>
        ))}
      </ul>
      {editingQuiz ? (
        <QuizBuilder
          key={editingQuiz}
          courseId={c.id}
          quizId={editingQuiz === 'new' ? undefined : editingQuiz}
          onCancel={() => setEditingQuiz(null)}
          onSaved={() => {
            setEditingQuiz(null);
            void course.reload();
          }}
        />
      ) : (
        <button className="btn" onClick={() => setEditingQuiz('new')}>
          + New quiz
        </button>
      )}

      <h2>Live classes</h2>
      <ul className="list card">
        {live.data?.items.length === 0 && <li className="muted">Nothing scheduled.</li>}
        {live.data?.items.map((lc) => (
          <li key={lc.id} className="row between">
            <span>
              {lc.title} · {formatDateTime(lc.scheduledAt)} <span className="badge">{lc.status}</span>
            </span>
            {lc.status !== 'ENDED' && (
              <Link className="btn btn-small" to={`/live/${lc.id}`}>
                Open room
              </Link>
            )}
          </li>
        ))}
      </ul>
      <form className="card form" onSubmit={schedule}>
        <h3>Schedule a live class</h3>
        <div className="row">
          <input placeholder="Title" value={liveForm.title} onChange={(e) => setLiveForm({ ...liveForm, title: e.target.value })} required />
          <input type="datetime-local" value={liveForm.scheduledAt} onChange={(e) => setLiveForm({ ...liveForm, scheduledAt: e.target.value })} required aria-label="Scheduled at" />
          <button className="btn">Schedule</button>
        </div>
      </form>
    </div>
  );
}
