'use client';

import { useCallback, useEffect, useState } from 'react';
import type { BriefSummary } from '@jamb/shared';
import { useAuth } from '../auth/AuthProvider';

export type BriefBoardState =
  | { status: 'loading' }
  | { status: 'ready'; briefs: BriefSummary[] }
  | { status: 'error'; message: string };

export type ClaimResult = { ok: true } | { ok: false; message: string };

/**
 * The open brief board (plan 7.12) — any active session, no role gate,
 * matching how `isEligibleForReviewer` already treats reviewers and
 * contributors as one pool.
 */
export function useBriefBoard(): {
  state: BriefBoardState;
  refresh: () => void;
  claim: (briefId: number) => Promise<ClaimResult>;
} {
  const { session, apiClient, logout } = useAuth();
  const [state, setState] = useState<BriefBoardState>({ status: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!session) {
      return;
    }
    let cancelled = false;
    setState({ status: 'loading' });

    apiClient.listOpenBriefs(session.token).then((outcome) => {
      if (cancelled) {
        return;
      }
      if (!outcome.ok) {
        if (outcome.reason === 'unauthorized') {
          logout();
          return;
        }
        setState({ status: 'error', message: outcome.message });
        return;
      }
      setState({ status: 'ready', briefs: outcome.briefs });
    });

    return () => {
      cancelled = true;
    };
  }, [session, apiClient, logout, reloadToken]);

  const refresh = useCallback(() => setReloadToken((token) => token + 1), []);

  const claim = useCallback(
    async (briefId: number): Promise<ClaimResult> => {
      if (!session) {
        return { ok: false, message: 'not authenticated' };
      }
      const outcome = await apiClient.claimBrief(session.token, briefId);
      if (!outcome.ok) {
        if (outcome.reason === 'unauthorized') {
          logout();
          return { ok: false, message: 'unauthorized' };
        }
        return { ok: false, message: outcome.message };
      }
      refresh();
      return { ok: true };
    },
    [session, apiClient, logout, refresh],
  );

  return { state, refresh, claim };
}
