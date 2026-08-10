import { describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { ContentDashboard } from '@jamb/shared';
import type { ApiClient } from '../lib/api-client';
import { AuthProvider } from '../auth/AuthProvider';
import { useContentLeadDashboard } from './useContentLeadDashboard';

const SESSION = { token: 'tok123', reviewerId: 3, role: 'content_lead' as const };

const DASHBOARD: ContentDashboard = {
  acceptedItemsPerReviewerHour: 1,
  rejectionReasons: [],
  queueDepth: [],
  itemsByState: [],
  costPerApprovedItem: { approvedCount: 0, avgInferenceCostUsd: 0, avgReviewerFeesKobo: 0 },
  interRaterAgreement: [],
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

describe('useContentLeadDashboard', () => {
  it('fetches the dashboard for the given since date when enabled', async () => {
    const calls: Date[] = [];
    const since = new Date('2026-01-01T00:00:00.000Z');
    const { result } = renderHook(() => useContentLeadDashboard(since, true), {
      wrapper: wrapperWith({
        getContentDashboard: async (_token, sinceArg) => {
          calls.push(sinceArg);
          return { ok: true, dashboard: DASHBOARD };
        },
      }),
    });

    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    expect(calls).toEqual([since]);
  });

  it('never calls the API when disabled', async () => {
    let called = false;
    const { result } = renderHook(() => useContentLeadDashboard(new Date(), false), {
      wrapper: wrapperWith({
        getContentDashboard: async () => {
          called = true;
          return { ok: true, dashboard: DASHBOARD };
        },
      }),
    });

    // Give any stray effect a tick to fire before asserting it didn't.
    await act(async () => {
      await Promise.resolve();
    });
    expect(called).toBe(false);
    expect(result.current.state.status).toBe('loading');
  });

  it('reports forbidden distinctly from a request failure', async () => {
    const { result } = renderHook(() => useContentLeadDashboard(new Date(), true), {
      wrapper: wrapperWith({
        getContentDashboard: async () => ({ ok: false, reason: 'forbidden' }),
      }),
    });

    await waitFor(() => expect(result.current.state.status).toBe('forbidden'));
  });

  it('refresh() triggers a second fetch', async () => {
    let calls = 0;
    const since = new Date('2026-01-01T00:00:00.000Z');
    const { result } = renderHook(() => useContentLeadDashboard(since, true), {
      wrapper: wrapperWith({
        getContentDashboard: async () => {
          calls += 1;
          return { ok: true, dashboard: DASHBOARD };
        },
      }),
    });

    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    expect(calls).toBe(1);

    act(() => {
      result.current.refresh();
    });

    await waitFor(() => expect(calls).toBe(2));
  });
});
