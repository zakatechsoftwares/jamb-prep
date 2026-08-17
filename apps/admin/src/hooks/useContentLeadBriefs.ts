'use client';

import { useCallback, useEffect, useState } from 'react';
import type { CoverageGap, CreateBriefInput } from '@jamb/shared';
import { useAuth } from '../auth/AuthProvider';

export type ContentLeadBriefsState =
  | { status: 'loading' }
  | { status: 'ready'; gaps: CoverageGap[] }
  | { status: 'forbidden' }
  | { status: 'error'; message: string };

export type CreateBriefResult = { ok: true; briefId: number } | { ok: false; message: string };

/**
 * Coverage gaps and brief creation (plan 7.12) for the content lead. Same
 * `enabled`-gated-fetch shape as `useContentLeadDashboard` — the page that
 * owns this hook redirects a non-content_lead session away, but that
 * redirect is itself an effect, so without `enabled` the fetch here would
 * still fire once on the same mount before the redirect runs.
 */
export function useContentLeadBriefs(enabled: boolean): {
  state: ContentLeadBriefsState;
  refresh: () => void;
  createBrief: (input: CreateBriefInput) => Promise<CreateBriefResult>;
} {
  const { session, apiClient, logout } = useAuth();
  const [state, setState] = useState<ContentLeadBriefsState>({ status: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!session || !enabled) {
      return;
    }
    let cancelled = false;
    setState({ status: 'loading' });

    apiClient.getGaps(session.token).then((outcome) => {
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
      setState({ status: 'ready', gaps: outcome.gaps });
    });

    return () => {
      cancelled = true;
    };
  }, [session, enabled, apiClient, logout, reloadToken]);

  const refresh = useCallback(() => setReloadToken((token) => token + 1), []);

  const createBrief = useCallback(
    async (input: CreateBriefInput): Promise<CreateBriefResult> => {
      if (!session) {
        return { ok: false, message: 'not authenticated' };
      }
      const outcome = await apiClient.createBrief(session.token, input);
      if (outcome.ok) {
        refresh();
        return { ok: true, briefId: outcome.briefId };
      }
      if (outcome.reason === 'unauthorized') {
        logout();
        return { ok: false, message: 'unauthorized' };
      }
      if (outcome.reason === 'forbidden') {
        return { ok: false, message: 'you do not have access to create briefs' };
      }
      return { ok: false, message: outcome.message };
    },
    [session, apiClient, logout, refresh],
  );

  return { state, refresh, createBrief };
}
