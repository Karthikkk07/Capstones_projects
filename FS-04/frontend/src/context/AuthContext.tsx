import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { SESSION_KEY, TOKEN_KEY, api } from '../api/client';
import type { AuthResponse, Role, User, WorkspaceRef } from '../api/types';
import { type Permission, roleCan } from '../lib/permissions';

interface Session {
  user: User;
  workspace: WorkspaceRef;
  role: Role;
}

interface AuthState {
  session: Session | null;
  can: (permission: Permission) => boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: { email: string; password: string; name: string; workspaceName: string }) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

function readStoredSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw && localStorage.getItem(TOKEN_KEY) ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(readStoredSession);

  const persist = useCallback((res: AuthResponse) => {
    const next: Session = { user: res.user, workspace: res.workspace, role: res.role };
    localStorage.setItem(TOKEN_KEY, res.token);
    localStorage.setItem(SESSION_KEY, JSON.stringify(next));
    setSession(next);
  }, []);

  useEffect(() => {
    const onUnauthorized = () => setSession(null);
    window.addEventListener('pm:unauthorized', onUnauthorized);
    return () => window.removeEventListener('pm:unauthorized', onUnauthorized);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      session,
      can: (permission) => !!session && roleCan(session.role, permission),
      login: async (email, password) => persist(await api.login({ email, password })),
      register: async (data) => persist(await api.register(data)),
      logout: () => {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(SESSION_KEY);
        setSession(null);
      },
    }),
    [session, persist],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
