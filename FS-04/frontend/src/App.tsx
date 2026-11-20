import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { Navbar } from './components/Navbar';
import { RequireAuth } from './components/RequireAuth';
import { useAuth } from './context/AuthContext';
import { AuditPage } from './pages/AuditPage';
import { LoginPage, RegisterPage } from './pages/AuthPages';
import { BillingPage } from './pages/BillingPage';
import { BoardPage } from './pages/BoardPage';
import { IssuePage } from './pages/IssuePage';
import { ProjectsPage } from './pages/ProjectsPage';
import { SprintsPage } from './pages/SprintsPage';
import { WebhooksPage } from './pages/WebhooksPage';

export default function App() {
  const { session } = useAuth();
  return (
    <>
      <Navbar />
      <main className="page">
        <Routes>
          <Route path="/login" element={session ? <Navigate to="/" replace /> : <LoginPage />} />
          <Route path="/register" element={session ? <Navigate to="/" replace /> : <RegisterPage />} />
          <Route path="/" element={<RequireAuth><ProjectsPage /></RequireAuth>} />
          <Route path="/projects/:projectId/board" element={<RequireAuth><BoardPage /></RequireAuth>} />
          <Route path="/projects/:projectId/sprints" element={<RequireAuth><SprintsPage /></RequireAuth>} />
          <Route path="/issues/:key" element={<RequireAuth><IssuePage /></RequireAuth>} />
          <Route path="/audit" element={<RequireAuth permission="audit:read"><AuditPage /></RequireAuth>} />
          <Route path="/settings/webhooks" element={<RequireAuth permission="webhook:manage"><WebhooksPage /></RequireAuth>} />
          <Route path="/billing" element={<RequireAuth permission="billing:read"><BillingPage /></RequireAuth>} />
          <Route
            path="*"
            element={
              <p>
                Page not found. <Link to="/">Back to projects</Link>
              </p>
            }
          />
        </Routes>
      </main>
    </>
  );
}
