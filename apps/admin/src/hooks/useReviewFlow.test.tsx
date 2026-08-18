import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { ReviewQueueItem, RevealResult } from '@jamb/shared';
import type { ApiClient } from '../lib/api-client';
import { createOfflineStore, type OfflineStore } from '../lib/offline-store';
import { AuthProvider } from '../auth/AuthProvider';
import { useReviewFlow } from './useReviewFlow';

const SESSION = { token: 'tok123', reviewerId: 7, role: 'reviewer' as const };

const ITEM: ReviewQueueItem = {
  itemId: 42,
  subjectId: 1,
  objectiveId: 7,
  stem: 'What is the SI unit of force?',
  options: [
    { label: 'A', text: 'newton' },
    { label: 'B', text: 'joule' },
    { label: 'C', text: 'watt' },
    { label: 'D', text: 'pascal' },
  ],
  cognitiveLevel: 'recall',
  independentSolveVerdict: 'agreed',
  claimExpiresAt: new Date('2026-08-09T10:00:00.000Z'),
  diagram: null,
};

const REVEAL: RevealResult = {
  correctOption: 'A',
  explanation: "Force is measured in newtons, per Newton's second law.",
  verdict: 'agreed',
  agreesWithKey: true,
};

function wrapperWith(apiClient: Partial<ApiClient>, offlineStore?: OfflineStore) {
  // Every test's session triggers the reconnect effect (prefetch + flush),
  // which calls getNextItemBatch regardless of whether that particular test
  // cares about offline behaviour — default it to an empty batch so tests
  // written before session 08 don't need to know about it.
  const merged: Partial<ApiClient> = {
    getNextItemBatch: async () => ({ ok: true, items: [] }),
    ...apiClient,
  };
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AuthProvider
        apiClient={merged as ApiClient}
        initialSession={SESSION}
        offlineStore={offlineStore}
      >
        {children}
      </AuthProvider>
    );
  };
}

function makeItem(itemId: number, claimExpiresAt = new Date('2026-08-09T10:00:00.000Z')): ReviewQueueItem {
  return { ...ITEM, itemId, claimExpiresAt };
}

let storeSeq = 0;
async function freshStore(): Promise<OfflineStore> {
  storeSeq += 1;
  return createOfflineStore(`use-review-flow-test-${storeSeq}`);
}

const openStores: OfflineStore[] = [];
afterEach(() => {
  for (const store of openStores.splice(0)) {
    store.close();
  }
  setOnline(true);
});

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { value, configurable: true });
  window.dispatchEvent(new Event(value ? 'online' : 'offline'));
}

describe('useReviewFlow', () => {
  it('serves a low-tier item straight to deciding, no solve step', async () => {
    const { result } = renderHook(() => useReviewFlow(), {
      wrapper: wrapperWith({
        getNextItem: async () => ({ ok: true, item: ITEM }),
        reveal: async () => ({ ok: true, result: REVEAL }),
      }),
    });

    await waitFor(() => expect(result.current.state.status).toBe('deciding'));
    expect(result.current.state).toMatchObject({ status: 'deciding', item: ITEM, reveal: REVEAL });
  });

  it('shows the solve step for a high-tier item, not yet revealed', async () => {
    const { result } = renderHook(() => useReviewFlow(), {
      wrapper: wrapperWith({
        getNextItem: async () => ({ ok: true, item: ITEM }),
        reveal: async () => ({ ok: false, reason: 'not_yet_solved' }),
      }),
    });

    await waitFor(() => expect(result.current.state.status).toBe('solving'));
    expect(result.current.state).toMatchObject({ status: 'solving', item: ITEM, selected: null });
  });

  it('moves to empty when the queue has nothing to serve', async () => {
    const { result } = renderHook(() => useReviewFlow(), {
      wrapper: wrapperWith({ getNextItem: async () => ({ ok: true, item: null }) }),
    });

    await waitFor(() => expect(result.current.state.status).toBe('empty'));
  });

  it('drives solve -> reveal -> deciding end to end for a high-tier item', async () => {
    let solved = false;
    const { result } = renderHook(() => useReviewFlow(), {
      wrapper: wrapperWith({
        getNextItem: async () => ({ ok: true, item: ITEM }),
        reveal: async () =>
          solved ? { ok: true, result: REVEAL } : { ok: false, reason: 'not_yet_solved' },
        submitSolve: async (_token, itemId, answer) => {
          solved = true;
          return { ok: true, itemId, answer };
        },
      }),
    });

    await waitFor(() => expect(result.current.state.status).toBe('solving'));

    act(() => result.current.selectOption('A'));
    expect(result.current.state).toMatchObject({ status: 'solving', selected: 'A' });

    await act(async () => {
      await result.current.submitSolve();
    });

    await waitFor(() => expect(result.current.state.status).toBe('deciding'));
    expect(result.current.state).toMatchObject({ reveal: REVEAL });
  });

  it('logs out on an unauthorized response, from getNextItem', async () => {
    const { result } = renderHook(() => useReviewFlow(), {
      wrapper: wrapperWith({ getNextItem: async () => ({ ok: false, reason: 'unauthorized' }) }),
    });

    // AuthProvider clears the session; useReviewFlow has nothing further to
    // do once there is no session to act on behalf of.
    await waitFor(() => expect(result.current.state.status).toBe('loading'));
  });

  it('approve submits the decision and loads the next item', async () => {
    const decideCalls: unknown[] = [];
    let requestCount = 0;
    const { result } = renderHook(() => useReviewFlow(), {
      wrapper: wrapperWith({
        getNextItem: async () => {
          requestCount += 1;
          return { ok: true, item: { ...ITEM, itemId: requestCount } };
        },
        reveal: async () => ({ ok: true, result: REVEAL }),
        decide: async (_token, itemId, input) => {
          decideCalls.push({ itemId, input });
          return {
            ok: true,
            itemId,
            status: 'approved_uncalibrated',
            approvalRoute: 'human_reviewed',
            decisionContext: 'live',
          };
        },
      }),
    });

    await waitFor(() => expect(result.current.state.status).toBe('deciding'));
    const firstItemId = (result.current.state as { item: ReviewQueueItem }).item.itemId;

    await act(async () => {
      await result.current.approve();
    });

    expect(decideCalls).toEqual([{ itemId: firstItemId, input: { action: 'approve' } }]);
    await waitFor(() => expect(result.current.state.status).toBe('deciding'));
    expect((result.current.state as { item: ReviewQueueItem }).item.itemId).not.toBe(firstItemId);
  });

  it('reject opens the reason picker, and choosing a reason submits it', async () => {
    const decideCalls: unknown[] = [];
    const { result } = renderHook(() => useReviewFlow(), {
      wrapper: wrapperWith({
        getNextItem: async () => ({ ok: true, item: ITEM }),
        reveal: async () => ({ ok: true, result: REVEAL }),
        decide: async (_token, itemId, input) => {
          decideCalls.push({ itemId, input });
          return { ok: true, itemId, status: 'rejected', approvalRoute: null, decisionContext: 'live' };
        },
      }),
    });

    await waitFor(() => expect(result.current.state.status).toBe('deciding'));

    act(() => result.current.startReject());
    expect(result.current.state.status).toBe('choosingReason');

    await act(async () => {
      await result.current.chooseReason('wrong_key');
    });

    expect(decideCalls).toEqual([
      { itemId: ITEM.itemId, input: { action: 'reject', rejectionReason: 'wrong_key' } },
    ]);
  });

  it('cancel returns from choosingReason to deciding without submitting anything', async () => {
    const decide = vi.fn();
    const { result } = renderHook(() => useReviewFlow(), {
      wrapper: wrapperWith({
        getNextItem: async () => ({ ok: true, item: ITEM }),
        reveal: async () => ({ ok: true, result: REVEAL }),
        decide,
      }),
    });

    await waitFor(() => expect(result.current.state.status).toBe('deciding'));
    act(() => result.current.startReject());
    act(() => result.current.cancel());

    expect(result.current.state.status).toBe('deciding');
    expect(decide).not.toHaveBeenCalled();
  });

  it('edit and approve sends the current draft as the edit patch', async () => {
    const decideCalls: unknown[] = [];
    const { result } = renderHook(() => useReviewFlow(), {
      wrapper: wrapperWith({
        getNextItem: async () => ({ ok: true, item: ITEM }),
        reveal: async () => ({ ok: true, result: REVEAL }),
        decide: async (_token, itemId, input) => {
          decideCalls.push({ itemId, input });
          return {
            ok: true,
            itemId,
            status: 'approved_uncalibrated',
            approvalRoute: 'human_reviewed',
            decisionContext: 'live',
          };
        },
      }),
    });

    await waitFor(() => expect(result.current.state.status).toBe('deciding'));

    act(() => result.current.startEdit());
    act(() => result.current.updateDraft({ stem: 'Corrected stem text' }));

    await act(async () => {
      await result.current.confirmEdit();
    });

    expect(decideCalls).toEqual([
      {
        itemId: ITEM.itemId,
        input: {
          action: 'edit_and_approve',
          edits: {
            stem: 'Corrected stem text',
            options: { A: 'newton', B: 'joule', C: 'watt', D: 'pascal' },
            key: 'A',
            explanation: REVEAL.explanation,
          },
        },
      },
    ]);
  });

  describe('reviewedThisSession', () => {
    it('starts at zero', async () => {
      const { result } = renderHook(() => useReviewFlow(), {
        wrapper: wrapperWith({ getNextItem: async () => ({ ok: true, item: null }) }),
      });

      await waitFor(() => expect(result.current.state.status).toBe('empty'));
      expect(result.current.reviewedThisSession).toBe(0);
    });

    it('increments once per successfully submitted decision', async () => {
      let requestCount = 0;
      const { result } = renderHook(() => useReviewFlow(), {
        wrapper: wrapperWith({
          getNextItem: async () => {
            requestCount += 1;
            return { ok: true, item: { ...ITEM, itemId: requestCount } };
          },
          reveal: async () => ({ ok: true, result: REVEAL }),
          decide: async (_token, itemId) => ({
            ok: true,
            itemId,
            status: 'approved_uncalibrated',
            approvalRoute: 'human_reviewed',
            decisionContext: 'live',
          }),
        }),
      });

      await waitFor(() => expect(result.current.state.status).toBe('deciding'));
      await act(async () => {
        await result.current.approve();
      });
      await waitFor(() => expect(result.current.reviewedThisSession).toBe(1));

      await waitFor(() => expect(result.current.state.status).toBe('deciding'));
      await act(async () => {
        await result.current.escalate();
      });
      await waitFor(() => expect(result.current.reviewedThisSession).toBe(2));
    });

    it('does not increment when the decision fails', async () => {
      const { result } = renderHook(() => useReviewFlow(), {
        wrapper: wrapperWith({
          getNextItem: async () => ({ ok: true, item: ITEM }),
          reveal: async () => ({ ok: true, result: REVEAL }),
          decide: async () => ({ ok: false, reason: 'not_claimed_by_you' }),
        }),
      });

      await waitFor(() => expect(result.current.state.status).toBe('deciding'));
      await act(async () => {
        await result.current.approve();
      });

      await waitFor(() => expect(result.current.state.status).toBe('error'));
      expect(result.current.reviewedThisSession).toBe(0);
    });
  });

  describe('offline (session 08)', () => {
    it('serves a cached item without calling the network when offline', async () => {
      const store = await freshStore();
      openStores.push(store);
      await store.cacheItems([{ item: makeItem(1), reveal: REVEAL, cachedAt: new Date() }]);
      setOnline(false);

      const getNextItem = vi.fn(async () => ({ ok: true as const, item: null }));
      const { result } = renderHook(() => useReviewFlow(), {
        wrapper: wrapperWith({ getNextItem }, store),
      });

      await waitFor(() => expect(result.current.state.status).toBe('deciding'));
      expect(result.current.state).toMatchObject({ item: { itemId: 1 }, reveal: REVEAL });
      expect(getNextItem).not.toHaveBeenCalled();
      expect(await store.countCachedItems()).toBe(0);
    });

    it('reports empty once the offline cache is drained', async () => {
      const store = await freshStore();
      openStores.push(store);
      setOnline(false);

      const { result } = renderHook(() => useReviewFlow(), {
        wrapper: wrapperWith({}, store),
      });

      await waitFor(() => expect(result.current.state.status).toBe('empty'));
    });

    it('queues a decision instead of calling decide when offline, and advances to the next cached item', async () => {
      const store = await freshStore();
      openStores.push(store);
      await store.cacheItems([
        { item: makeItem(1), reveal: REVEAL, cachedAt: new Date() },
        { item: makeItem(2, new Date('2026-08-09T09:00:00Z')), reveal: REVEAL, cachedAt: new Date() },
      ]);
      setOnline(false);

      const decide = vi.fn();
      const { result } = renderHook(() => useReviewFlow(), {
        wrapper: wrapperWith({ decide }, store),
      });

      await waitFor(() => expect(result.current.state.status).toBe('deciding'));
      // Oldest claim first.
      expect(result.current.state).toMatchObject({ item: { itemId: 2 } });

      await act(async () => {
        await result.current.approve();
      });

      expect(decide).not.toHaveBeenCalled();
      await waitFor(() => expect(result.current.reviewedThisSession).toBe(1));
      expect(result.current.state).toMatchObject({ status: 'deciding', item: { itemId: 1 } });
      expect(await store.countPendingDecisions()).toBe(1);
    });

    it('queues a blind answer for a high-tier item offline and stays queued, since reveal is online-only', async () => {
      const store = await freshStore();
      openStores.push(store);
      await store.cacheItems([{ item: makeItem(9), reveal: null, cachedAt: new Date() }]);
      setOnline(false);

      const submitSolve = vi.fn();
      const { result } = renderHook(() => useReviewFlow(), {
        wrapper: wrapperWith({ submitSolve }, store),
      });

      await waitFor(() => expect(result.current.state.status).toBe('solving'));
      act(() => result.current.selectOption('B'));
      await act(async () => {
        await result.current.submitSolve();
      });

      expect(submitSolve).not.toHaveBeenCalled();
      expect(result.current.state).toMatchObject({ status: 'solving', queued: true, selected: 'B' });
      expect(await store.countPendingSolves()).toBe(1);
    });

    it('uploads every queued decision, each with its own idempotency key, once reconnected', async () => {
      const store = await freshStore();
      openStores.push(store);
      for (let i = 1; i <= 10; i += 1) {
        await store.queueDecision({
          idempotencyKey: `key-${i}`,
          itemId: i,
          input: { action: 'approve' },
          queuedAt: new Date(),
        });
      }
      expect(await store.countPendingDecisions()).toBe(10);

      const decideCalls: { itemId: number; idempotencyKey: string | undefined }[] = [];
      const { result } = renderHook(() => useReviewFlow(), {
        wrapper: wrapperWith(
          {
            getNextItem: async () => ({ ok: true, item: null }),
            decide: async (_token, itemId, _input, idempotencyKey) => {
              decideCalls.push({ itemId, idempotencyKey });
              return {
                ok: true,
                itemId,
                status: 'approved_uncalibrated',
                approvalRoute: 'human_reviewed',
                decisionContext: 'live',
              };
            },
          },
          store,
        ),
      });
      void result;

      await waitFor(() => expect(decideCalls).toHaveLength(10));
      expect(new Set(decideCalls.map((c) => c.idempotencyKey)).size).toBe(10);
      await waitFor(async () => expect(await store.countPendingDecisions()).toBe(0));
    });

    it('reuses the same idempotency key across retries of a decision that failed to sync, rather than minting a fresh one', async () => {
      const store = await freshStore();
      openStores.push(store);
      await store.queueDecision({
        idempotencyKey: 'stable-key-1',
        itemId: 1,
        input: { action: 'approve' },
        queuedAt: new Date(),
      });

      const decideCalls: (string | undefined)[] = [];
      let attempt = 0;
      const { result } = renderHook(() => useReviewFlow(), {
        wrapper: wrapperWith(
          {
            getNextItem: async () => ({ ok: true, item: null }),
            decide: async (_token, itemId, _input, idempotencyKey) => {
              decideCalls.push(idempotencyKey);
              attempt += 1;
              if (attempt === 1) {
                return { ok: false, reason: 'request_failed', message: 'offline' };
              }
              return {
                ok: true,
                itemId,
                status: 'approved_uncalibrated',
                approvalRoute: 'human_reviewed',
                decisionContext: 'live',
              };
            },
          },
          store,
        ),
      });

      await waitFor(() => expect(decideCalls).toHaveLength(1));
      expect(await store.countPendingDecisions()).toBe(1);

      // A second reconnect (connectivity flapped, or the app was reopened)
      // retries the same queued decision. The two toggles are committed as
      // separate renders — back to back in the same tick, React's
      // automatic batching would coalesce them into a net no-op.
      act(() => setOnline(false));
      await waitFor(() => expect(result.current.isOnline).toBe(false));
      act(() => setOnline(true));

      await waitFor(() => expect(decideCalls).toHaveLength(2));
      expect(decideCalls).toEqual(['stable-key-1', 'stable-key-1']);
      await waitFor(async () => expect(await store.countPendingDecisions()).toBe(0));
    });

    it('counts a synced decision that comes back as a late arrival, rather than treating it as an ordinary success silently', async () => {
      const store = await freshStore();
      openStores.push(store);
      await store.queueDecision({
        idempotencyKey: 'key-1',
        itemId: 1,
        input: { action: 'reject', rejectionReason: 'wrong_key' },
        queuedAt: new Date(),
      });

      const { result } = renderHook(() => useReviewFlow(), {
        wrapper: wrapperWith(
          {
            getNextItem: async () => ({ ok: true, item: null }),
            decide: async (_t, itemId) => ({
              ok: true,
              itemId,
              status: 'approved_uncalibrated',
              approvalRoute: 'human_reviewed',
              decisionContext: 'late_arrival',
            }),
          },
          store,
        ),
      });

      await waitFor(() => expect(result.current.lateArrivalCount).toBe(1));
      await waitFor(async () => expect(await store.countPendingDecisions()).toBe(0));
    });

    it('reviewing 10 items fully offline then reconnecting syncs all ten exactly once', async () => {
      const store = await freshStore();
      openStores.push(store);
      const items = Array.from({ length: 10 }, (_, i) =>
        makeItem(i + 1, new Date(2026, 7, 9, 10, i)),
      );
      await store.cacheItems(items.map((item) => ({ item, reveal: REVEAL, cachedAt: new Date() })));
      setOnline(false);

      const decideCalls: number[] = [];
      const decide = vi.fn(async (_token: string, itemId: number) => {
        decideCalls.push(itemId);
        return {
          ok: true as const,
          itemId,
          status: 'approved_uncalibrated' as const,
          approvalRoute: 'human_reviewed' as const,
          decisionContext: 'live' as const,
        };
      });
      const { result } = renderHook(() => useReviewFlow(), {
        wrapper: wrapperWith({ decide, getNextItem: async () => ({ ok: true, item: null }) }, store),
      });

      await waitFor(() => expect(result.current.state.status).toBe('deciding'));
      for (let i = 0; i < 10; i += 1) {
        await waitFor(() => expect(result.current.state.status).toBe('deciding'));
        await act(async () => {
          await result.current.approve();
        });
      }

      await waitFor(() => expect(result.current.state.status).toBe('empty'));
      expect(decide).not.toHaveBeenCalled();
      expect(result.current.reviewedThisSession).toBe(10);
      expect(await store.countPendingDecisions()).toBe(10);

      setOnline(true);

      await waitFor(() => expect(decideCalls).toHaveLength(10));
      expect(new Set(decideCalls)).toEqual(new Set(items.map((item) => item.itemId)));
      await waitFor(async () => expect(await store.countPendingDecisions()).toBe(0));
    });
  });
});
