import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <header className="navbar">
      <Link to="/" className="brand">
        LMS<span>Live</span>
      </Link>
      <nav>
        <NavLink to="/">Courses</NavLink>
        {user?.role === 'STUDENT' && <NavLink to="/dashboard">My learning</NavLink>}
        {(user?.role === 'INSTRUCTOR' || user?.role === 'ADMIN') && (
          <>
            <NavLink to="/instructor">My courses</NavLink>
            <NavLink to="/instructor/revenue">Revenue</NavLink>
          </>
        )}
        {user?.role === 'ADMIN' && <NavLink to="/admin">Moderation</NavLink>}
      </nav>
      <div className="nav-right">
        {user ? (
          <>
            <span className="muted">
              {user.name} <span className="badge">{user.role}</span>
            </span>
            <button
              className="btn btn-ghost"
              onClick={() => {
                logout();
                navigate('/');
              }}
            >
              Log out
            </button>
          </>
        ) : (
          <>
            <Link className="btn btn-ghost" to="/login">
              Log in
            </Link>
            <Link className="btn" to="/register">
              Sign up
            </Link>
          </>
        )}
      </div>
    </header>
  );
}
