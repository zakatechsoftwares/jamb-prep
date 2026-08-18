'use client';

import { useCallback, useEffect, useState } from 'react';
import type { IllustrationTicketSummary } from '@jamb/shared';
import { useAuth } from '../auth/AuthProvider';

export type IllustrationBoardState =
  | { status: 'loading' }
  | { status: 'ready'; tickets: IllustrationTicketSummary[] }
  | { status: 'error'; message: string };

export type ClaimTicketResult = { ok: true } | { ok: false; message: string };

/**
 * The illustrator queue (plan 7.12 step 5) — any active session, no role
 * gate, matching `useBriefBoard`'s own "one pool" decision: illustrators
 * are not a new `PANEL_ROLES` value.
 */
export function useIllustrationBoard(): {
  state: IllustrationBoardState;
  refresh: () => void;
  claim: (ticketId: number) => Promise<ClaimTicketResult>;
} {
  const { session, apiClient, logout } = useAuth();
  const [state, setState] = useState<IllustrationBoardState>({ status: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!session) {
      return;
    }
    let cancelled = false;
    setState({ status: 'loading' });

    apiClient.listOpenIllustrationTickets(session.token).then((outcome) => {
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
      setState({ status: 'ready', tickets: outcome.tickets });
    });

    return () => {
      cancelled = true;
    };
  }, [session, apiClient, logout, reloadToken]);

  const refresh = useCallback(() => setReloadToken((token) => token + 1), []);

  const claim = useCallback(
    async (ticketId: number): Promise<ClaimTicketResult> => {
      if (!session) {
        return { ok: false, message: 'not authenticated' };
      }
      const outcome = await apiClient.claimIllustrationTicket(session.token, ticketId);
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
