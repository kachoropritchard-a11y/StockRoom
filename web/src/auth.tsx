import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, type User } from './api';

interface AuthState {
  user: User | null;
  loading: boolean;
  needsSetup: boolean;
  checkStatus: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  pinLogin: (pin: string) => Promise<void>;
  setupInitialManager: (body: Parameters<typeof api.setupInitialManager>[0]) => Promise<User>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

/** Home route for each role's portal. */
export const portalPath = (role: User['role']) => (role === 'executive_manager' ? '/executive' : '/inventory');

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);

  const checkStatus = useCallback(async () => {
    try {
      const st = await api.systemStatus();
      setNeedsSetup(st.needsSetup);
    } catch {
      setNeedsSetup(false);
    }
  }, []);

  useEffect(() => {
    Promise.all([
      api.me().then((r) => {
        setUser(r.user);
        setNeedsSetup(false);
      }).catch(() => setUser(null)),
      api.systemStatus().then((st) => setNeedsSetup(st.needsSetup)).catch(() => setNeedsSetup(false)),
    ]).finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.login(email, password);
    setUser(res.user);
    setNeedsSetup(false);
  }, []);

  const pinLogin = useCallback(async (pin: string) => {
    const res = await api.pinLogin(pin);
    setUser(res.user);
    setNeedsSetup(false);
  }, []);

  const setupInitialManager = useCallback(async (body: Parameters<typeof api.setupInitialManager>[0]) => {
    const res = await api.setupInitialManager(body);
    setUser(res.user);
    setNeedsSetup(false);
    return res.user;
  }, []);

  const logout = useCallback(async () => {
    await api.logout().catch(() => undefined);
    setUser(null);
    await checkStatus();
  }, [checkStatus]);

  const value = useMemo(
    () => ({ user, loading, needsSetup, checkStatus, login, pinLogin, setupInitialManager, logout }),
    [user, loading, needsSetup, checkStatus, login, pinLogin, setupInitialManager, logout],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside AuthProvider');
  return v;
}
