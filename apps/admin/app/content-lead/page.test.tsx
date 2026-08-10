import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { ContentDashboard } from '@jamb/shared';
import type { ApiClient } from '../../src/lib/api-client';
import { AuthProvider } from '../../src/auth/AuthProvider';
import ContentLeadPage from './page';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
}));

const DASHBOARD: ContentDashboard = {
  acceptedItemsPerReviewerHour: 2,
  rejectionReasons: [],
  queueDepth: [],
  itemsByState: [],
  costPerApprovedItem: { approvedCount: 0, avgInferenceCostUsd: 0, avgReviewerFeesKobo: 0 },
  interRaterAgreement: [],
};

describe('ContentLeadPage', () => {
  it('redirects to /login when there is no session', () => {
    replace.mockClear();
    render(
      <AuthProvider apiClient={{} as ApiClient}>
        <ContentLeadPage />
      </AuthProvider>,
    );

    expect(replace).toHaveBeenCalledWith('/login');
  });

  it('redirects a non-content-lead session to the reviewer workspace', () => {
    replace.mockClear();
    render(
      <AuthProvider
        apiClient={{} as ApiClient}
        initialSession={{ token: 'tok123', reviewerId: 7, role: 'reviewer' }}
      >
        <ContentLeadPage />
      </AuthProvider>,
    );

    expect(replace).toHaveBeenCalledWith('/');
  });

  it('renders the dashboard for a content-lead session', async () => {
    replace.mockClear();
    const apiClient = {
      getContentDashboard: async () => ({ ok: true, dashboard: DASHBOARD }),
    } as unknown as ApiClient;

    render(
      <AuthProvider
        apiClient={apiClient}
        initialSession={{ token: 'tok123', reviewerId: 7, role: 'content_lead' }}
      >
        <ContentLeadPage />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByText('Content lead dashboard')).toBeTruthy());
    expect(replace).not.toHaveBeenCalled();
  });

  it('shows an error state and retries on demand', async () => {
    replace.mockClear();
    let calls = 0;
    const apiClient = {
      getContentDashboard: async () => {
        calls += 1;
        return calls === 1
          ? { ok: false, reason: 'request_failed', message: 'could not reach the server' }
          : { ok: true, dashboard: DASHBOARD };
      },
    } as unknown as ApiClient;

    render(
      <AuthProvider
        apiClient={apiClient}
        initialSession={{ token: 'tok123', reviewerId: 7, role: 'content_lead' }}
      >
        <ContentLeadPage />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByText('could not reach the server')).toBeTruthy());

    screen.getByText('Try again').click();

    await waitFor(() => expect(screen.getByText('Content lead dashboard')).toBeTruthy());
  });
});
