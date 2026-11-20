import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { formatMoney } from '../lib/format';
import { errorMessage, useAsync } from '../lib/useAsync';

export function InstructorCoursesPage() {
  const courses = useAsync(() => api.instructorCourses(), []);
  const navigate = useNavigate();
  const [form, setForm] = useState({ title: '', description: '', category: 'General', price: '0' });
  const [error, setError] = useState<string | null>(null);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const c = await api.createCourse({
        title: form.title,
        description: form.description,
        category: form.category,
        priceCents: Math.round(Number(form.price) * 100),
      });
      navigate(`/instructor/courses/${c.id}`);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div>
      <h1>My courses</h1>
      {courses.error && <p className="error">{courses.error}</p>}
      <table className="table">
        <thead>
          <tr>
            <th>Title</th>
            <th>Status</th>
            <th>Price</th>
            <th>Lessons</th>
            <th>Students</th>
          </tr>
        </thead>
        <tbody>
          {courses.data?.items.map((c) => (
            <tr key={c.id}>
              <td>
                <Link to={`/instructor/courses/${c.id}`}>{c.title}</Link>
              </td>
              <td>
                <span className={`badge ${c.status === 'DRAFT' ? 'warn' : 'ok'}`}>{c.status}</span>
              </td>
              <td>{formatMoney(c.priceCents)}</td>
              <td>{c._count?.lessons ?? 0}</td>
              <td>{c._count?.enrollments ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <form className="card form" onSubmit={create}>
        <h3>Create a course</h3>
        {error && <p className="error">{error}</p>}
        <label>
          Title
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} minLength={3} required />
        </label>
        <label>
          Description
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} required />
        </label>
        <div className="row">
          <label>
            Category
            <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} required />
          </label>
          <label>
            Price (USD, 0 = free)
            <input type="number" min={0} step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
          </label>
        </div>
        <button className="btn">Create draft</button>
      </form>
    </div>
  );
}
