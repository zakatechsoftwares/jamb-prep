import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ApiClient, ChangePasswordOutcome } from '../../../src/lib/api-client';
import { AuthProvider, type AuthSession } from '../../../src/auth/AuthProvider';
import ChangePasswordPage from './page';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
}));

function fakeClient(outcome: ChangePasswordOutcome) {
  return { changePassword: vi.fn(async () => outcome) } as unknown as ApiClient;
}

const FORCED: AuthSession = {
  token: 'tok123',
  reviewerId: 7,
  role: 'reviewer',
  mustChangePassword: true,
};

async function submit(current: string, next: string) {
  const user = userEvent.setup({ delay: null });
  await user.click(screen.getByLabelText('Current password'));
  await user.paste(current);
  await user.click(screen.getByLabelText('New password'));
  await user.paste(next);
  await user.click(screen.getByLabelText('Confirm new password'));
  await user.paste(next);
  await user.click(screen.getByRole('button', { name: /save password/i }));
}

describe('ChangePasswordPage', () => {
  beforeEach(() => replace.mockClear());

  it('redirects to /login when there is no session', () => {
    render(
      <AuthProvider apiClient={fakeClient({ ok: true })}>
        <ChangePasswordPage />
      </AuthProvider>,
    );
    expect(replace).toHaveBeenCalledWith('/login');
  });

  it('changes a forced temporary password and sends the reviewer on to the workspace', async () => {
    const client = fakeClient({ ok: true });
    render(
      <AuthProvider apiClient={client} initialSession={FORCED}>
        <ChangePasswordPage />
      </AuthProvider>,
    );

    expect(screen.getByRole('heading', { name: /choose your password/i })).toBeTruthy();
    await submit('TempPass2345', 'my-own-secret');

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
    expect(client.changePassword).toHaveBeenCalledWith('tok123', 'TempPass2345', 'my-own-secret');
  });

  it('sends a content lead on to the dashboard afterwards', async () => {
    render(
      <AuthProvider
        apiClient={fakeClient({ ok: true })}
        initialSession={{ ...FORCED, role: 'content_lead' }}
      >
        <ChangePasswordPage />
      </AuthProvider>,
    );

    await submit('TempPass2345', 'my-own-secret');
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/content-lead'));
  });

  it('says the temporary password is wrong, and stays put', async () => {
    render(
      <AuthProvider
        apiClient={fakeClient({ ok: false, reason: 'wrong_current_password' })}
        initialSession={FORCED}
      >
        <ChangePasswordPage />
      </AuthProvider>,
    );

    await submit('not-it', 'my-own-secret');

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('That temporary password is not correct.'),
    );
    expect(replace).not.toHaveBeenCalled();
  });
});
