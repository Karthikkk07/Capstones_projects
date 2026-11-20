import { api } from '../api/client';
import { formatMoney } from '../lib/format';
import { errorMessage, useAsync } from '../lib/useAsync';
import { Link } from 'react-router-dom';
import { useState } from 'react';

export function AdminPage() {
  const courses = useAsync(() => api.adminCourses(), []);
  const [error, setError] = useState<string | null>(null);

  async function toggle(id: string, status: 'DRAFT' | 'PUBLISHED') {
    setError(null);
    try {
      if (status === 'PUBLISHED') await api.unpublishCourse(id);
      else await api.publishCourse(id);
      await courses.reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <div>
      <h1>Course moderation</h1>
      {(courses.error || error) && <p className="error">{error ?? courses.error}</p>}
      <table className="table">
        <thead>
          <tr>
            <th>Course</th>
            <th>Instructor</th>
            <th>Price</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {courses.data?.items.map((c) => (
            <tr key={c.id}>
              <td>
                <Link to={`/instructor/courses/${c.id}`}>{c.title}</Link>
              </td>
              <td>{c.instructor?.name}</td>
              <td>{formatMoney(c.priceCents)}</td>
              <td>
                <span className={`badge ${c.status === 'DRAFT' ? 'warn' : 'ok'}`}>{c.status}</span>
              </td>
              <td>
                <button className="btn btn-small" onClick={() => toggle(c.id, c.status)}>
                  {c.status === 'PUBLISHED' ? 'Unpublish' : 'Publish'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
