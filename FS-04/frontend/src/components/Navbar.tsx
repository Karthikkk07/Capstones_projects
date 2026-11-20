import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export function Navbar() {
  const { session, can, logout } = useAuth();
  const navigate = useNavigate();
  if (!session) return null;
  return (
    <header className="navbar">
      <NavLink to="/" className="brand">
        Taskboard
      </NavLink>
      <nav>
        <NavLink to="/">Projects</NavLink>
        {can('audit:read') && <NavLink to="/audit">Audit log</NavLink>}
        {can('webhook:manage') && <NavLink to="/settings/webhooks">Webhooks</NavLink>}
        {can('billing:read') && <NavLink to="/billing">Billing</NavLink>}
      </nav>
      <div className="navbar-user">
        <span>
          {session.workspace.name} · {session.user.name} <span className="badge">{session.role}</span>
        </span>
        <button
          className="btn btn-ghost"
          onClick={() => {
            logout();
            navigate('/login');
          }}
        >
          Sign out
        </button>
      </div>
    </header>
  );
}
