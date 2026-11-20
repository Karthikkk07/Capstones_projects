import { type ReactNode, createContext, useCallback, useContext, useMemo, useState } from 'react';
import { TOKEN_KEY, USER_KEY, api } from '../api/client';
import type { Role, User } from '../api/types';

interface AuthState {
  user: User | null;
  login: (email: string, password: string) => Promise<User>;
  register: (data: { email: string; password: string; name: string; role: Exclude<Role, 'ADMIN'> }) => Promise<User>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

function readStoredUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw && localStorage.getItem(TOKEN_KEY) ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(readStoredUser);

  const persist = useCallback((res: { token: string; user: User }) => {
    localStorage.setItem(TOKEN_KEY, res.token);
    localStorage.setItem(USER_KEY, JSON.stringify(res.user));
    setUser(res.user);
    return res.user;
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      login: async (email, password) => persist(await api.login({ email, password })),
      register: async (data) => persist(await api.register(data)),
      logout: () => {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        setUser(null);
      },
    }),
    [user, persist],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
