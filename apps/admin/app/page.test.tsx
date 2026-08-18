import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReviewQueueItem, RevealResult } from '@jamb/shared';
import type { ApiClient } from '../src/lib/api-client';
import { AuthProvider } from '../src/auth/AuthProvider';
import ReviewPage from './page';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
}));

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
  agreesWithKey: null,
};

describe('ReviewPage', () => {
  it('redirects to /login when there is no session', () => {
    replace.mockClear();
    render(
      <AuthProvider apiClient={{} as ApiClient}>
        <ReviewPage />
      </AuthProvider>,
    );

    expect(replace).toHaveBeenCalledWith('/login');
  });

  it('renders the decide step for an authenticated reviewer with a served item, and no browse controls anywhere', async () => {
    replace.mockClear();
    const apiClient = {
      getNextItem: async () => ({ ok: true, item: ITEM }),
      reveal: async () => ({ ok: true, result: REVEAL }),
    } as unknown as ApiClient;

    render(
      <AuthProvider
        apiClient={apiClient}
        initialSession={{ token: 'tok123', reviewerId: 7, role: 'reviewer' }}
      >
        <ReviewPage />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByText(ITEM.stem)).toBeTruthy());
    expect(replace).not.toHaveBeenCalled();

    // 7.9: no list, filter, search or queue browser anywhere in this tree.
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByText(/queue|filter|browse/i)).toBeNull();
  });
});
