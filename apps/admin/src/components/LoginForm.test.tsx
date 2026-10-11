import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ApiClient, LoginOutcome } from '../lib/api-client';
import { AuthProvider } from '../auth/AuthProvider';
import { LoginForm } from './LoginForm';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
}));

function fakeApiClient(login: (emailOrPhone: string, password: string) => Promise<LoginOutcome>) {
  return { login } as unknown as ApiClient;
}

describe('LoginForm', () => {
  it('logs in and redirects to the review screen on success', async () => {
    const user = userEvent.setup();
    render(
      <AuthProvider
        apiClient={fakeApiClient(async () => ({
          ok: true,
          token: 'tok123',
          reviewerId: 7,
          role: 'reviewer',
          mustChangePassword: false,
        }))}
      >
        <LoginForm />
      </AuthProvider>,
    );

    await user.type(screen.getByLabelText(/email or phone/i), 'reviewer@example.test');
    await user.type(screen.getByLabelText(/password/i), 'hunter2');
    await user.click(screen.getByRole('button', { name: /log in/i }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
  });

  it('sends a session holding a temporary password to the change-password screen', async () => {
    const user = userEvent.setup();
    replace.mockClear();
    render(
      <AuthProvider
        apiClient={fakeApiClient(async () => ({
          ok: true,
          token: 'tok123',
          reviewerId: 7,
          role: 'reviewer',
          mustChangePassword: true,
        }))}
      >
        <LoginForm />
      </AuthProvider>,
    );

    await user.type(screen.getByLabelText(/email or phone/i), 'reviewer@example.test');
    await user.type(screen.getByLabelText(/password/i), 'TempPass2345');
    await user.click(screen.getByRole('button', { name: /log in/i }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/account/password'));
    expect(replace).not.toHaveBeenCalledWith('/');
  });

  it('sends a content lead to the dashboard', async () => {
    const user = userEvent.setup();
    replace.mockClear();
    render(
      <AuthProvider
        apiClient={fakeApiClient(async () => ({
          ok: true,
          token: 'tok123',
          reviewerId: 1,
          role: 'content_lead',
          mustChangePassword: false,
        }))}
      >
        <LoginForm />
      </AuthProvider>,
    );

    await user.type(screen.getByLabelText(/email or phone/i), 'lead@example.test');
    await user.type(screen.getByLabelText(/password/i), 'hunter22');
    await user.click(screen.getByRole('button', { name: /log in/i }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/content-lead'));
  });

  it('shows an error and does not redirect on invalid credentials', async () => {
    const user = userEvent.setup();
    replace.mockClear();
    render(
      <AuthProvider
        apiClient={fakeApiClient(async () => ({ ok: false, reason: 'invalid_credentials' }))}
      >
        <LoginForm />
      </AuthProvider>,
    );

    await user.type(screen.getByLabelText(/email or phone/i), 'reviewer@example.test');
    await user.type(screen.getByLabelText(/password/i), 'wrong');
    await user.click(screen.getByRole('button', { name: /log in/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(replace).not.toHaveBeenCalled();
  });

  it('never distinguishes wrong credentials from an unknown identifier in the shown message', async () => {
    // The server already collapses these; the form must not re-introduce
    // the distinction by, say, mentioning "no such reviewer".
    const user = userEvent.setup();
    render(
      <AuthProvider
        apiClient={fakeApiClient(async () => ({ ok: false, reason: 'invalid_credentials' }))}
      >
        <LoginForm />
      </AuthProvider>,
    );

    await user.type(screen.getByLabelText(/email or phone/i), 'nobody@example.test');
    await user.type(screen.getByLabelText(/password/i), 'anything');
    await user.click(screen.getByRole('button', { name: /log in/i }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).not.toMatch(/no such|not found|unknown/i);
  });
});
