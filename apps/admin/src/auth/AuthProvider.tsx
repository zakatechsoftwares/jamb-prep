'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { PanelRole } from '@jamb/shared';
import { createApiClient, type ApiClient, type LoginOutcome } from '../lib/api-client';

/**
 * In memory only — a module-level `useState`, never `localStorage` or
 * `sessionStorage`. A hard refresh loses the session and the reviewer logs
 * in again; that is the deliberate trade this session's brief asks for,
 * not an oversight to fix later.
 */
export interface AuthSession {
  token: string;
  reviewerId: number;
  role: PanelRole;
}

interface AuthContextValue {
  session: AuthSession | null;
  apiClient: ApiClient;
  login(emailOrPhone: string, password: string): Promise<LoginOutcome>;
  logout(): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export interface AuthProviderProps {
  children: ReactNode;
  /** Injected for tests; defaults to a real client against the same-origin proxy. */
  apiClient?: ApiClient;
  /** Test-only: seeds an already-authenticated session, skipping login. */
  initialSession?: AuthSession | null;
}

export function AuthProvider({ children, apiClient, initialSession = null }: AuthProviderProps) {
  const client = useMemo(() => apiClient ?? createApiClient(fetch), [apiClient]);
  const [session, setSession] = useState<AuthSession | null>(initialSession);

  const login = useCallback(
    async (emailOrPhone: string, password: string): Promise<LoginOutcome> => {
      const outcome = await client.login(emailOrPhone, password);
      if (outcome.ok) {
        setSession({ token: outcome.token, reviewerId: outcome.reviewerId, role: outcome.role });
      }
      return outcome;
    },
    [client],
  );

  const logout = useCallback(() => setSession(null), []);

  const value = useMemo<AuthContextValue>(
    () => ({ session, apiClient: client, login, logout }),
    [session, client, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === null) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
