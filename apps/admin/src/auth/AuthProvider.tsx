'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { PanelRole } from '@jamb/shared';
import {
  createApiClient,
  type ApiClient,
  type ChangePasswordOutcome,
  type LoginOutcome,
} from '../lib/api-client';
import { createOfflineStore, type OfflineStore } from '../lib/offline-store';

/** One database for the life of the app — every reviewer session on this
 * device shares the same offline cache and upload queue. */
const OFFLINE_STORE_DB_NAME = 'jamb-reviewer-offline';

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
  /**
   * True while the account still holds a temporary password a content
   * lead issued. `PasswordChangeGate` keeps every screen except
   * `/account/password` unreachable until it clears.
   */
  mustChangePassword: boolean;
}

interface AuthContextValue {
  session: AuthSession | null;
  apiClient: ApiClient;
  /**
   * Null until the underlying IndexedDB open resolves (near-instant in
   * practice, but genuinely async) — consumers that run before it's ready
   * simply skip offline behaviour for that render rather than blocking on it.
   */
  offlineStore: OfflineStore | null;
  login(emailOrPhone: string, password: string): Promise<LoginOutcome>;
  /** Clears `session.mustChangePassword` on success; logs out on a 401. */
  changePassword(currentPassword: string, newPassword: string): Promise<ChangePasswordOutcome>;
  logout(): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export interface AuthProviderProps {
  children: ReactNode;
  /** Injected for tests; defaults to a real client against the same-origin proxy. */
  apiClient?: ApiClient;
  /** Test-only: seeds an already-authenticated session, skipping login. */
  initialSession?: AuthSession | null;
  /** Injected for tests; defaults to opening a real IndexedDB-backed store. */
  offlineStore?: OfflineStore;
}

export function AuthProvider({
  children,
  apiClient,
  initialSession = null,
  offlineStore,
}: AuthProviderProps) {
  const client = useMemo(() => apiClient ?? createApiClient(fetch), [apiClient]);
  const [session, setSession] = useState<AuthSession | null>(initialSession);
  const [store, setStore] = useState<OfflineStore | null>(offlineStore ?? null);

  useEffect(() => {
    if (offlineStore) {
      // Injected for tests — already open, nothing to do.
      return;
    }
    let cancelled = false;
    void createOfflineStore(OFFLINE_STORE_DB_NAME).then((opened) => {
      if (!cancelled) {
        setStore(opened);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [offlineStore]);

  const login = useCallback(
    async (emailOrPhone: string, password: string): Promise<LoginOutcome> => {
      const outcome = await client.login(emailOrPhone, password);
      if (outcome.ok) {
        setSession({
          token: outcome.token,
          reviewerId: outcome.reviewerId,
          role: outcome.role,
          mustChangePassword: outcome.mustChangePassword,
        });
      }
      return outcome;
    },
    [client],
  );

  const logout = useCallback(() => setSession(null), []);

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string): Promise<ChangePasswordOutcome> => {
      if (!session) {
        return { ok: false, reason: 'unauthorized' };
      }
      const outcome = await client.changePassword(session.token, currentPassword, newPassword);
      if (outcome.ok) {
        setSession((current) => (current ? { ...current, mustChangePassword: false } : current));
      } else if (outcome.reason === 'unauthorized') {
        setSession(null);
      }
      return outcome;
    },
    [client, session],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ session, apiClient: client, offlineStore: store, login, changePassword, logout }),
    [session, client, store, login, changePassword, logout],
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
