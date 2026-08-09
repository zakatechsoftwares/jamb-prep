'use client';

import { useCallback, useEffect, useReducer, useState } from 'react';
import type { OptionLabel, RejectionReason } from '@jamb/shared';
import { useAuth } from '../auth/AuthProvider';
import type { DecideRequestInput } from '../lib/api-client';
import {
  INITIAL_REVIEW_FLOW_STATE,
  reduceReviewFlow,
  type ItemEditDraftPatch,
} from '../lib/review-flow-reducer';

/**
 * The single orchestrator of the one-item review screen (plan 7.9):
 * fetches the next item, checks reveal to decide solve-first vs.
 * straight-to-deciding, and drives every one of the four actions. All the
 * actual *decision* logic is `reduceReviewFlow`, tested on its own with no
 * I/O; this hook's only job is sequencing the API calls and translating
 * their outcomes into the events that reducer understands.
 *
 * A `reason: 'unauthorized'` outcome from any call — the one thing all
 * five reviewer routes agree on — calls `logout()` and stops, uniformly.
 * `AuthProvider` clearing the session is what the page-level redirect to
 * `/login` reacts to; this hook does not redirect directly.
 */
export function useReviewFlow() {
  const { session, apiClient, logout } = useAuth();
  const [state, dispatch] = useReducer(reduceReviewFlow, INITIAL_REVIEW_FLOW_STATE);
  // Counts decisions submitted since this login, not "today" — there is no
  // server-side source for a real daily total yet (session F / canonical
  // session 09 is unbuilt). Resets on refresh along with the rest of the
  // in-memory session; ReviewHeader labels it accordingly rather than
  // implying a number it cannot back up.
  const [reviewedThisSession, setReviewedThisSession] = useState(0);

  const requestNextItem = useCallback(async () => {
    if (!session) {
      return;
    }
    dispatch({ type: 'requestStarted' });

    const outcome = await apiClient.getNextItem(session.token);
    if (!outcome.ok) {
      if (outcome.reason === 'unauthorized') {
        logout();
        return;
      }
      dispatch({ type: 'requestFailed', message: outcome.message });
      return;
    }
    if (!outcome.item) {
      dispatch({ type: 'queueEmpty' });
      return;
    }

    const item = outcome.item;
    const revealed = await apiClient.reveal(session.token, item.itemId);
    if (!revealed.ok) {
      if (revealed.reason === 'unauthorized') {
        logout();
        return;
      }
      if (revealed.reason === 'not_yet_solved') {
        dispatch({ type: 'itemNeedsSolve', item });
        return;
      }
      // not_claimed_by_you immediately after being served the item is not
      // an ordinary outcome — something else claimed it in the moment
      // between serve and reveal. Surfacing it as an error, with a retry,
      // is simpler and safer than guessing at a silent recovery.
      dispatch({ type: 'requestFailed', message: 'this item is no longer available — try again' });
      return;
    }
    dispatch({ type: 'itemRevealed', item, reveal: revealed.result });
  }, [session, apiClient, logout]);

  useEffect(() => {
    // requestNextItem's own identity only ever changes when session does
    // (apiClient and logout are both stable), so this effect's job is
    // still exactly "kick off once per session," not "on every render."
    if (session) {
      void requestNextItem();
    }
  }, [session, requestNextItem]);

  const selectOption = useCallback((option: OptionLabel) => {
    dispatch({ type: 'selectOption', option });
  }, []);

  const submitSolve = useCallback(async () => {
    if (state.status !== 'solving' || state.selected === null || !session) {
      return;
    }
    const { item, selected } = state;
    dispatch({ type: 'solveSubmitted' });

    const solved = await apiClient.submitSolve(session.token, item.itemId, selected);
    if (!solved.ok) {
      if (solved.reason === 'unauthorized') {
        logout();
        return;
      }
      dispatch({
        type: 'requestFailed',
        message: `could not record your answer (${solved.reason})`,
      });
      return;
    }

    const revealed = await apiClient.reveal(session.token, item.itemId);
    if (!revealed.ok) {
      if (revealed.reason === 'unauthorized') {
        logout();
        return;
      }
      dispatch({ type: 'requestFailed', message: 'could not reveal the key after solving' });
      return;
    }
    dispatch({ type: 'itemRevealed', item, reveal: revealed.result });
  }, [state, session, apiClient, logout]);

  const startReject = useCallback(() => dispatch({ type: 'startReject' }), []);
  const startEdit = useCallback(() => dispatch({ type: 'startEdit' }), []);
  const updateDraft = useCallback(
    (patch: ItemEditDraftPatch) => dispatch({ type: 'updateDraft', patch }),
    [],
  );
  const cancel = useCallback(() => dispatch({ type: 'cancel' }), []);

  const submitDecision = useCallback(
    async (input: DecideRequestInput) => {
      if (
        (state.status !== 'deciding' &&
          state.status !== 'choosingReason' &&
          state.status !== 'editing') ||
        !session
      ) {
        return;
      }
      const itemId = state.item.itemId;
      dispatch({ type: 'decisionSubmitted' });

      const outcome = await apiClient.decide(session.token, itemId, input);
      if (!outcome.ok) {
        if (outcome.reason === 'unauthorized') {
          logout();
          return;
        }
        const message =
          outcome.reason === 'invalid_transition'
            ? outcome.message
            : `could not record your decision (${outcome.reason})`;
        dispatch({ type: 'requestFailed', message });
        return;
      }

      setReviewedThisSession((count) => count + 1);
      await requestNextItem();
    },
    [state, session, apiClient, logout, requestNextItem],
  );

  const approve = useCallback(() => submitDecision({ action: 'approve' }), [submitDecision]);
  const escalate = useCallback(() => submitDecision({ action: 'escalate' }), [submitDecision]);
  const chooseReason = useCallback(
    (reason: RejectionReason) => submitDecision({ action: 'reject', rejectionReason: reason }),
    [submitDecision],
  );
  const confirmEdit = useCallback(() => {
    if (state.status !== 'editing') {
      return Promise.resolve();
    }
    return submitDecision({ action: 'edit_and_approve', edits: state.draft });
  }, [state, submitDecision]);

  const retry = useCallback(() => requestNextItem(), [requestNextItem]);

  return {
    state,
    reviewedThisSession,
    selectOption,
    submitSolve,
    startReject,
    startEdit,
    updateDraft,
    cancel,
    approve,
    escalate,
    chooseReason,
    confirmEdit,
    retry,
  };
}
