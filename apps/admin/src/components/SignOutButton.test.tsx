import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ApiClient } from '../lib/api-client';
import { createOfflineStore, type OfflineStore } from '../lib/offline-store';
import { AuthProvider, useAuth, type AuthSession } from '../auth/AuthProvider';
import { SignOutButton } from './SignOutButton';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
}));

const SESSION: AuthSession = {
  token: 'tok123',
  reviewerId: 7,
  role: 'reviewer',
  mustChangePassword: false,
};

let storeCounter = 0;
async function freshStore(): Promise<OfflineStore> {
  storeCounter += 1;
  return createOfflineStore(`sign-out-button-test-${storeCounter}-${Date.now()}`);
}

function SessionProbe() {
  const { session } = useAuth();
  return <span data-testid="session">{session ? 'signed in' : 'signed out'}</span>;
}

function renderWith(store: OfflineStore) {
  render(
    <AuthProvider apiClient={{} as ApiClient} initialSession={SESSION} offlineStore={store}>
      <SessionProbe />
      <SignOutButton />
    </AuthProvider>,
  );
}

async function queueOneDecision(store: OfflineStore) {
  await store.queueDecision({
    idempotencyKey: 'key-1',
    itemId: 2,
    input: { action: 'approve' },
    queuedAt: new Date(),
  });
}

describe('SignOutButton', () => {
  beforeEach(() => replace.mockClear());

  it('signs out straight away, clears the device cache, and goes to login when nothing is unsent', async () => {
    const user = userEvent.setup({ delay: null });
    const store = await freshStore();
    await store.cacheItems([
      {
        item: {
          itemId: 1,
          subjectId: 1,
          objectiveId: 1,
          stem: 'stem',
          options: [],
          cognitiveLevel: 'recall',
          independentSolveVerdict: 'agreed',
          claimExpiresAt: new Date(),
          diagram: null,
        },
        reveal: null,
        cachedAt: new Date(),
      },
    ]);
    renderWith(store);

    await user.click(screen.getByRole('button', { name: /^sign out$/i }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
    expect(screen.getByTestId('session').textContent).toBe('signed out');
    expect(await store.countCachedItems()).toBe(0);
  });

  it('warns about unsent reviews instead of signing out, and Stay keeps everything', async () => {
    const user = userEvent.setup({ delay: null });
    const store = await freshStore();
    await queueOneDecision(store);
    renderWith(store);

    await user.click(screen.getByRole('button', { name: /^sign out$/i }));

    const warning = await screen.findByRole('alertdialog', { name: /unsent reviews/i });
    expect(warning.textContent).toMatch(/1 review not yet uploaded/);
    expect(replace).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /stay signed in/i }));

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByTestId('session').textContent).toBe('signed in');
    expect(await store.countPendingDecisions()).toBe(1);
  });

  it('discards unsent reviews and signs out when the reviewer chooses to', async () => {
    const user = userEvent.setup({ delay: null });
    const store = await freshStore();
    await queueOneDecision(store);
    await store.queueSolve({ itemId: 3, answer: 'B', queuedAt: new Date() });
    renderWith(store);

    await user.click(screen.getByRole('button', { name: /^sign out$/i }));
    expect((await screen.findByRole('alertdialog')).textContent).toMatch(/2 reviews/);
    await user.click(screen.getByRole('button', { name: /sign out anyway/i }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
    expect(screen.getByTestId('session').textContent).toBe('signed out');
    expect(await store.countPendingDecisions()).toBe(0);
    expect(await store.countPendingSolves()).toBe(0);
  });
});
