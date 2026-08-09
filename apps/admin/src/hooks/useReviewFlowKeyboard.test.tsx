import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { ReviewQueueItem, RevealResult } from '@jamb/shared';
import type { ApiClient } from '../lib/api-client';
import { AuthProvider } from '../auth/AuthProvider';
import { useReviewFlow } from './useReviewFlow';
import { useReviewFlowKeyboard } from './useReviewFlowKeyboard';

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
  explanation: 'Because...',
  verdict: 'agreed',
  agreesWithKey: true,
};

function Harness() {
  const flow = useReviewFlowKeyboardTestSubject();
  return (
    <div>
      <p data-testid="status">{flow.state.status}</p>
      <p data-testid="selected">{'selected' in flow.state ? flow.state.selected : ''}</p>
      {/* A stand-in for InlineEditForm's text field, to prove key handling is suppressed inside it. */}
      <input aria-label="stem" />
    </div>
  );
}

function useReviewFlowKeyboardTestSubject() {
  const flow = useReviewFlow();
  useReviewFlowKeyboard(flow);
  return flow;
}

function wrapperWith(apiClient: Partial<ApiClient>) {
  // The reconnect effect (session 08) always calls getNextItemBatch once a
  // session exists — default it so tests written before that don't need to
  // know about it.
  const merged: Partial<ApiClient> = {
    getNextItemBatch: async () => ({ ok: true, items: [] }),
    ...apiClient,
  };
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AuthProvider apiClient={merged as ApiClient} initialSession={SESSION}>
        {children}
      </AuthProvider>
    );
  };
}

describe('useReviewFlowKeyboard', () => {
  it('A-D selects an option while solving, Enter submits', async () => {
    let solved = false;
    render(<Harness />, {
      wrapper: wrapperWith({
        getNextItem: async () => ({ ok: true, item: ITEM }),
        reveal: async () =>
          solved ? { ok: true, result: REVEAL } : { ok: false, reason: 'not_yet_solved' },
        submitSolve: async (_t, itemId, answer) => {
          solved = true;
          return { ok: true, itemId, answer };
        },
      }),
    });

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('solving'));

    act(() => {
      fireEvent.keyDown(window, { key: 'b' });
    });
    await waitFor(() => expect(screen.getByTestId('selected').textContent).toBe('B'));

    await act(async () => {
      fireEvent.keyDown(window, { key: 'Enter' });
    });

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('deciding'));
  });

  it('1-4 drive the four decide actions', async () => {
    render(<Harness />, {
      wrapper: wrapperWith({
        getNextItem: async () => ({ ok: true, item: ITEM }),
        reveal: async () => ({ ok: true, result: REVEAL }),
      }),
    });

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('deciding'));

    act(() => {
      fireEvent.keyDown(window, { key: '3' });
    });
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('choosingReason'));
  });

  it('Escape cancels out of choosingReason back to deciding', async () => {
    render(<Harness />, {
      wrapper: wrapperWith({
        getNextItem: async () => ({ ok: true, item: ITEM }),
        reveal: async () => ({ ok: true, result: REVEAL }),
      }),
    });

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('deciding'));
    act(() => fireEvent.keyDown(window, { key: '3' }));
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('choosingReason'));

    act(() => fireEvent.keyDown(window, { key: 'Escape' }));
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('deciding'));
  });

  it('ignores A-D and 1-4 while a text field has focus, but Escape still cancels', async () => {
    render(<Harness />, {
      wrapper: wrapperWith({
        getNextItem: async () => ({ ok: true, item: ITEM }),
        reveal: async () => ({ ok: true, result: REVEAL }),
      }),
    });

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('deciding'));
    act(() => {
      screen.getByLabelText('stem').focus();
    });

    act(() => {
      fireEvent.keyDown(screen.getByLabelText('stem'), { key: '3' });
    });
    // Still deciding — '3' typed into a text field must not start reject.
    // No waitFor here on purpose: this asserts a negative (nothing
    // happened), so there is nothing to await — a real regression would
    // still show up deterministically as a status mismatch.
    expect(screen.getByTestId('status').textContent).toBe('deciding');

    act(() => fireEvent.keyDown(window, { key: '3' }));
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('choosingReason'));

    act(() => {
      screen.getByLabelText('stem').focus();
      fireEvent.keyDown(screen.getByLabelText('stem'), { key: 'Escape' });
    });
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('deciding'));
  });
});
