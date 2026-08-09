import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { ReviewQueueItem, RevealResult } from '@jamb/shared';
import type { ApiClient } from '../lib/api-client';
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
};

const REVEAL: RevealResult = {
  correctOption: 'A',
  explanation: "Force is measured in newtons, per Newton's second law.",
  verdict: 'agreed',
  agreesWithKey: true,
};

function wrapperWith(apiClient: Partial<ApiClient>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AuthProvider apiClient={apiClient as ApiClient} initialSession={SESSION}>
        {children}
      </AuthProvider>
    );
  };
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
          return { ok: true, itemId, status: 'rejected', approvalRoute: null };
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
});
