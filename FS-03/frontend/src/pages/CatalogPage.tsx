import { type FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { formatMoney } from '../lib/format';
import { useAsync } from '../lib/useAsync';

export function CatalogPage() {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);

  const categories = useAsync(() => api.categories(), []);
  const courses = useAsync(() => api.listCourses({ q: query, category, page, pageSize: 9 }), [query, category, page]);

  function submit(e: FormEvent) {
    e.preventDefault();
    setPage(1);
    setQuery(search.trim());
  }

  return (
    <div>
      <section className="hero">
        <h1>Learn new skills, live and on-demand</h1>
        <form className="row search" onSubmit={submit}>
          <input placeholder="Search courses…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search courses" />
          <select
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setPage(1);
            }}
            aria-label="Category"
          >
            <option value="">All categories</option>
            {categories.data?.items.map((c) => (
              <option key={c.category} value={c.category}>
                {c.category} ({c.count})
              </option>
            ))}
          </select>
          <button className="btn">Search</button>
        </form>
      </section>

      {courses.error && <p className="error">{courses.error}</p>}
      {courses.loading && <p className="muted">Loading courses…</p>}
      {courses.data && courses.data.items.length === 0 && <p className="muted">No courses match your search.</p>}

      <div className="grid-3">
        {courses.data?.items.map((c) => (
          <Link key={c.id} to={`/courses/${c.slug}`} className="card course-card">
            <img src={c.thumbnail ?? `https://picsum.photos/seed/${c.slug}/640/360`} alt="" loading="lazy" />
            <span className="badge">{c.category}</span>
            <h3>{c.title}</h3>
            <p className="muted">by {c.instructor?.name} · {c._count?.lessons ?? 0} lessons</p>
            <strong>{formatMoney(c.priceCents)}</strong>
          </Link>
        ))}
      </div>

      {courses.data && courses.data.totalPages > 1 && (
        <div className="row center">
          <button className="btn btn-ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <span className="muted">
            Page {courses.data.page} of {courses.data.totalPages}
          </span>
          <button className="btn btn-ghost" disabled={page >= courses.data.totalPages} onClick={() => setPage(page + 1)}>
            Next
          </button>
        </div>
      )}
    </div>
  );
}
