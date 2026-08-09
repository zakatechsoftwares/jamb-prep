'use client';

import { useCallback, useEffect, useReducer, useState } from 'react';
import type { OptionLabel, RejectionReason } from '@jamb/shared';
import { useAuth } from '../auth/AuthProvider';
import type { DecideRequestInput } from '../lib/api-client';
import type { CachedQueueItem, OfflineStore } from '../lib/offline-store';
import {
  INITIAL_REVIEW_FLOW_STATE,
  reduceReviewFlow,
  type ItemEditDraftPatch,
} from '../lib/review-flow-reducer';

/** How many claimed items to pull into the local cache per prefetch (8.3). */
const PREFETCH_BATCH_SIZE = 10;

function useIsOnline(): boolean {
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return isOnline;
}

/** The oldest-expiring cached item — matches the live queue's own instinct
 * to hand out the item under the most time pressure first. */
function oldestCached(cached: CachedQueueItem[]): CachedQueueItem {
  return cached.reduce((earliest, entry) =>
    entry.item.claimExpiresAt < earliest.item.claimExpiresAt ? entry : earliest,
  );
}

interface OfflineCounts {
  cachedItemCount: number;
  pendingDecisionCount: number;
  pendingSolveCount: number;
  nextClaimExpiry: Date | null;
}

const EMPTY_OFFLINE_COUNTS: OfflineCounts = {
  cachedItemCount: 0,
  pendingDecisionCount: 0,
  pendingSolveCount: 0,
  nextClaimExpiry: null,
};

async function readOfflineCounts(store: OfflineStore): Promise<OfflineCounts> {
  const [cachedItemCount, pendingDecisionCount, pendingSolveCount, nextClaimExpiry] =
    await Promise.all([
      store.countCachedItems(),
      store.countPendingDecisions(),
      store.countPendingSolves(),
      store.nextClaimExpiry(),
    ]);
  return { cachedItemCount, pendingDecisionCount, pendingSolveCount, nextClaimExpiry };
}

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
 *
 * Offline (session 08, plan 7.9 "offline capable" / 8.3): every network
 * call in this hook has an offline twin that reads from or writes to the
 * `OfflineStore` (IndexedDB) instead. `requestNextItem` pulls from the
 * cache; `submitSolve`/`submitDecision` queue instead of posting. A
 * high-tier item's reveal is deliberately never cached — see
 * offline-store.ts — so a blind answer queued offline has nowhere to
 * advance to until reconnection actually reveals it; the reducer's
 * `queued` flag on `solving` is what holds that resting state. Reconnect
 * (the browser's `online` event) triggers both an upload of everything
 * queued and a fresh prefetch, via the same `flushQueue`/`prefetchBatch`
 * pair `requestStarted`'s effect always runs on session/store/connectivity
 * change.
 */
export function useReviewFlow() {
  const { session, apiClient, offlineStore, logout } = useAuth();
  const [state, dispatch] = useReducer(reduceReviewFlow, INITIAL_REVIEW_FLOW_STATE);
  const isOnline = useIsOnline();
  // Counts decisions submitted since this login, not "today" — there is no
  // server-side source for a real daily total yet (session F / canonical
  // session 09 is unbuilt). Resets on refresh along with the rest of the
  // in-memory session; ReviewHeader labels it accordingly rather than
  // implying a number it cannot back up.
  const [reviewedThisSession, setReviewedThisSession] = useState(0);
  // A synced decision the server recorded as an audit-only second opinion
  // rather than the authoritative outcome (8.3's late-arrival case) — never
  // silently folded into an ordinary success count.
  const [lateArrivalCount, setLateArrivalCount] = useState(0);
  const [offlineCounts, setOfflineCounts] = useState<OfflineCounts>(EMPTY_OFFLINE_COUNTS);

  const refreshOfflineCounts = useCallback(async () => {
    if (!offlineStore) {
      return;
    }
    setOfflineCounts(await readOfflineCounts(offlineStore));
  }, [offlineStore]);

  useEffect(() => {
    void refreshOfflineCounts();
  }, [refreshOfflineCounts]);

  const requestNextItem = useCallback(async () => {
    if (!session) {
      return;
    }
    dispatch({ type: 'requestStarted' });

    if (!isOnline) {
      if (!offlineStore) {
        dispatch({ type: 'requestFailed', message: 'offline, and the local cache is not ready yet' });
        return;
      }
      const cached = await offlineStore.getCachedItems();
      if (cached.length === 0) {
        dispatch({ type: 'queueEmpty' });
        return;
      }
      const next = oldestCached(cached);
      await offlineStore.removeCachedItem(next.item.itemId);
      await refreshOfflineCounts();
      if (next.reveal) {
        dispatch({ type: 'itemRevealed', item: next.item, reveal: next.reveal });
      } else {
        dispatch({ type: 'itemNeedsSolve', item: next.item });
      }
      return;
    }

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
  }, [session, isOnline, offlineStore, apiClient, logout, refreshOfflineCounts]);

  /** Prefetches a fresh batch of claimed items into the cache. Low/not-generated-tier
   * items get their reveal cached too, since `canReveal` allows it unconditionally;
   * a high-tier item's reveal always stays uncached — see offline-store.ts. */
  const prefetchBatch = useCallback(async () => {
    if (!session || !offlineStore) {
      return;
    }
    const batch = await apiClient.getNextItemBatch(session.token, PREFETCH_BATCH_SIZE);
    if (!batch.ok) {
      if (batch.reason === 'unauthorized') {
        logout();
      }
      return;
    }

    const toCache: CachedQueueItem[] = [];
    for (const item of batch.items) {
      const revealed = await apiClient.reveal(session.token, item.itemId);
      if (revealed.ok) {
        toCache.push({ item, reveal: revealed.result, cachedAt: new Date() });
      } else if (!revealed.ok && revealed.reason === 'unauthorized') {
        logout();
        return;
      } else if (!revealed.ok && revealed.reason === 'not_yet_solved') {
        toCache.push({ item, reveal: null, cachedAt: new Date() });
      }
      // not_claimed_by_you here means something reclaimed it between the
      // batch call and this reveal call — simply not cached, not an error.
    }

    if (toCache.length > 0) {
      await offlineStore.cacheItems(toCache);
      await refreshOfflineCounts();
    }
  }, [session, offlineStore, apiClient, logout, refreshOfflineCounts]);

  /** Uploads every queued blind answer and decision (8.3's "syncs on
   * reconnection"). A queued decision's idempotency key is what makes
   * re-running this safely repeatable — see decideOnItem's ON CONFLICT
   * handling — so nothing here needs its own duplicate-detection. */
  const flushQueue = useCallback(async () => {
    if (!session || !offlineStore) {
      return;
    }

    const pendingSolves = await offlineStore.getPendingSolves();
    for (const solve of pendingSolves) {
      const solved = await apiClient.submitSolve(session.token, solve.itemId, solve.answer);
      if (!solved.ok) {
        if (solved.reason === 'unauthorized') {
          logout();
          return;
        }
        if (solved.reason === 'request_failed') {
          // Still offline (or connectivity flapped mid-sync) — stop for now,
          // the next reconnect will pick this back up.
          break;
        }
        // not_claimed_by_you: the claim is gone and nothing further can be
        // done with a bare blind answer — there is no late-arrival path for
        // `solve`, only for `decide`. Drop it rather than retrying forever.
      }
      const stillHeld = solved.ok || (!solved.ok && solved.reason === 'not_claimed_by_you');
      if (stillHeld) {
        await offlineStore.removePendingSolve(solve.itemId);
      }
      if (
        solved.ok &&
        state.status === 'solving' &&
        state.queued &&
        state.item.itemId === solve.itemId
      ) {
        const revealed = await apiClient.reveal(session.token, solve.itemId);
        if (revealed.ok) {
          dispatch({ type: 'itemRevealed', item: state.item, reveal: revealed.result });
        } else if (!revealed.ok && revealed.reason === 'unauthorized') {
          logout();
          return;
        } else {
          dispatch({ type: 'requestFailed', message: 'could not reveal the key after reconnecting' });
        }
      }
    }

    const pendingDecisions = await offlineStore.getPendingDecisions();
    let syncedLateArrivals = 0;
    for (const decision of pendingDecisions) {
      const outcome = await apiClient.decide(
        session.token,
        decision.itemId,
        decision.input,
        decision.idempotencyKey,
      );
      if (outcome.ok) {
        await offlineStore.removePendingDecision(decision.idempotencyKey);
        if (outcome.decisionContext === 'late_arrival') {
          syncedLateArrivals += 1;
        }
      } else if (outcome.reason === 'unauthorized') {
        logout();
        return;
      } else if (outcome.reason === 'request_failed') {
        break;
      }
      // invalid_transition / not_claimed_by_you on a queued decision is not
      // expected — decideOnItem accepts anything this reviewer once held —
      // but never silently dropped either: left queued for the next sync
      // attempt rather than guessed at here.
    }

    if (syncedLateArrivals > 0) {
      setLateArrivalCount((count) => count + syncedLateArrivals);
    }
    await refreshOfflineCounts();
  }, [session, offlineStore, apiClient, logout, state, refreshOfflineCounts]);

  useEffect(() => {
    // Deliberately keyed on session/store/connectivity only, not on
    // flushQueue/prefetchBatch's identities (which change on every state
    // update) — this is "run once per connect or reconnect," not "run on
    // every render." Whichever closures are current when it fires are the
    // ones used; nothing here depends on a stale one.
    if (session && offlineStore && isOnline) {
      void flushQueue().then(() => prefetchBatch());
    }
  }, [session, offlineStore, isOnline]);

  useEffect(() => {
    // Keyed on session alone, deliberately not on requestNextItem's own
    // identity: that now also changes whenever offlineStore resolves from
    // null to a real instance (AuthProvider's IndexedDB open is async) or
    // isOnline flips, and re-running this on either would abandon whatever
    // the reviewer is mid-way through — reconnect already has its own
    // effect (flushQueue/prefetchBatch) for background sync; it should
    // never itself pull a fresh item out from under an in-progress screen.
    // This still calls whichever requestNextItem closure is current at the
    // moment session first becomes available, not a stale one.
    if (session) {
      void requestNextItem();
    }
  }, [session]);

  const selectOption = useCallback((option: OptionLabel) => {
    dispatch({ type: 'selectOption', option });
  }, []);

  const submitSolve = useCallback(async () => {
    if (state.status !== 'solving' || state.selected === null || !session) {
      return;
    }
    const { item, selected } = state;
    dispatch({ type: 'solveSubmitted' });

    if (!isOnline) {
      if (offlineStore) {
        await offlineStore.queueSolve({ itemId: item.itemId, answer: selected, queuedAt: new Date() });
        await refreshOfflineCounts();
      }
      dispatch({ type: 'blindAnswerQueued' });
      return;
    }

    const solved = await apiClient.submitSolve(session.token, item.itemId, selected);
    if (!solved.ok) {
      if (solved.reason === 'unauthorized') {
        logout();
        return;
      }
      if (solved.reason === 'request_failed' && offlineStore) {
        // The live attempt failed only because connectivity dropped
        // mid-request — queue it exactly as a deliberate offline submission
        // would be, rather than surfacing a hard error for what is really
        // just "no network right now".
        await offlineStore.queueSolve({ itemId: item.itemId, answer: selected, queuedAt: new Date() });
        await refreshOfflineCounts();
        dispatch({ type: 'blindAnswerQueued' });
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
  }, [state, session, isOnline, offlineStore, apiClient, logout, refreshOfflineCounts]);

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

      const queueOffline = async () => {
        if (offlineStore) {
          await offlineStore.queueDecision({
            idempotencyKey: crypto.randomUUID(),
            itemId,
            input,
            queuedAt: new Date(),
          });
          await refreshOfflineCounts();
        }
        setReviewedThisSession((count) => count + 1);
        await requestNextItem();
      };

      if (!isOnline) {
        await queueOffline();
        return;
      }

      const outcome = await apiClient.decide(session.token, itemId, input);
      if (!outcome.ok) {
        if (outcome.reason === 'unauthorized') {
          logout();
          return;
        }
        if (outcome.reason === 'request_failed') {
          await queueOffline();
          return;
        }
        const message =
          outcome.reason === 'invalid_transition'
            ? outcome.message
            : `could not record your decision (${outcome.reason})`;
        dispatch({ type: 'requestFailed', message });
        return;
      }

      if (outcome.decisionContext === 'late_arrival') {
        setLateArrivalCount((count) => count + 1);
      }
      setReviewedThisSession((count) => count + 1);
      await requestNextItem();
    },
    [state, session, isOnline, offlineStore, apiClient, logout, requestNextItem, refreshOfflineCounts],
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
    lateArrivalCount,
    isOnline,
    ...offlineCounts,
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
