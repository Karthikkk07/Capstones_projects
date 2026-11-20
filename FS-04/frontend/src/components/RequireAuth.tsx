import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import type { Permission } from '../lib/permissions';

export function RequireAuth({ permission, children }: { permission?: Permission; children: ReactNode }) {
  const { session, can } = useAuth();
  const location = useLocation();
  if (!session) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  if (permission && !can(permission)) return <p className="error">You do not have access to this page.</p>;
  return <>{children}</>;
}
