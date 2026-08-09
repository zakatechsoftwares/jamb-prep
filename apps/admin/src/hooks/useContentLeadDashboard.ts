'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ContentDashboard } from '@jamb/shared';
import { useAuth } from '../auth/AuthProvider';

export type ContentLeadDashboardState =
  | { status: 'loading' }
  | { status: 'ready'; dashboard: ContentDashboard }
  | { status: 'forbidden' }
  | { status: 'error'; message: string };

/**
 * Fetches the content-lead dashboard (plan 7.11) for the current session
 * and `since` cutoff. A `reason: 'unauthorized'` outcome logs out, the same
 * uniform handling `useReviewFlow` gives every reviewer route.
 *
 * `enabled` gates the actual fetch — the page that owns this hook redirects
 * a non-content_lead session away, but that redirect is itself an effect,
 * so without this flag the fetch effect here would still fire once on the
 * same mount (hooks run unconditionally; the page's early return happens
 * after they do), hitting a route the session has no business calling.
 * Pass `session?.role === 'content_lead'`.
 */
export function useContentLeadDashboard(
  since: Date,
  enabled: boolean,
): {
  state: ContentLeadDashboardState;
  refresh: () => void;
} {
  const { session, apiClient, logout } = useAuth();
  const [state, setState] = useState<ContentLeadDashboardState>({ status: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);
  const sinceTime = since.getTime();

  useEffect(() => {
    if (!session || !enabled) {
      return;
    }
    let cancelled = false;
    setState({ status: 'loading' });

    apiClient.getContentDashboard(session.token, new Date(sinceTime)).then((outcome) => {
      if (cancelled) {
        return;
      }
      if (!outcome.ok) {
        if (outcome.reason === 'unauthorized') {
          logout();
          return;
        }
        if (outcome.reason === 'forbidden') {
          setState({ status: 'forbidden' });
          return;
        }
        setState({ status: 'error', message: outcome.message });
        return;
      }
      setState({ status: 'ready', dashboard: outcome.dashboard });
    });

    return () => {
      cancelled = true;
    };
  }, [session, enabled, apiClient, logout, sinceTime, reloadToken]);

  const refresh = useCallback(() => setReloadToken((token) => token + 1), []);

  return { state, refresh };
}
