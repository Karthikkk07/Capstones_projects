import { type FormEvent, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ErrorBanner } from '../components/Feedback';
import { useAuth } from '../context/AuthContext';
import { errorMessage } from '../lib/useAsync';

function useRedirect() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';
  return () => navigate(from, { replace: true });
}

export function LoginPage() {
  const { login } = useAuth();
  const redirect = useRedirect();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      redirect();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form className="card auth-card" onSubmit={submit}>
      <h1>Sign in</h1>
      <ErrorBanner message={error} />
      <label>
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
      </label>
      <label>
        Password
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </label>
      <button className="btn btn-primary" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
      <p className="muted">
        New here? <Link to="/register">Create a workspace</Link>
      </p>
    </form>
  );
}

export function RegisterPage() {
  const { register } = useAuth();
  const redirect = useRedirect();
  const [form, setForm] = useState({ name: '', email: '', password: '', workspaceName: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await register(form);
      redirect();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form className="card auth-card" onSubmit={submit}>
      <h1>Create your workspace</h1>
      <ErrorBanner message={error} />
      <label>
        Workspace name
        <input value={form.workspaceName} onChange={set('workspaceName')} required minLength={2} maxLength={100} autoFocus />
      </label>
      <label>
        Your name
        <input value={form.name} onChange={set('name')} required maxLength={100} />
      </label>
      <label>
        Email
        <input type="email" value={form.email} onChange={set('email')} required />
      </label>
      <label>
        Password (min 8 characters)
        <input type="password" value={form.password} onChange={set('password')} required minLength={8} />
      </label>
      <button className="btn btn-primary" disabled={busy}>
        {busy ? 'Creating…' : 'Create workspace'}
      </button>
      <p className="muted">
        Already have an account? <Link to="/login">Sign in</Link>
      </p>
    </form>
  );
}
