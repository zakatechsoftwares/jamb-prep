import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ApiClient, LoginOutcome } from '../lib/api-client';
import { AuthProvider, useAuth } from './AuthProvider';

function fakeApiClient(login: (emailOrPhone: string, password: string) => Promise<LoginOutcome>) {
  return { login } as unknown as ApiClient;
}

function Consumer() {
  const auth = useAuth();
  return (
    <div>
      <div data-testid="session">{auth.session ? JSON.stringify(auth.session) : 'none'}</div>
      <button onClick={() => auth.login('reviewer@example.test', 'hunter2')}>login</button>
      <button onClick={() => auth.logout()}>logout</button>
    </div>
  );
}

describe('AuthProvider / useAuth', () => {
  it('starts with no session', () => {
    render(
      <AuthProvider apiClient={fakeApiClient(async () => ({ ok: false, reason: 'invalid_credentials' }))}>
        <Consumer />
      </AuthProvider>,
    );

    expect(screen.getByTestId('session').textContent).toBe('none');
  });

  it('sets the session in memory when login succeeds', async () => {
    const user = userEvent.setup();
    render(
      <AuthProvider
        apiClient={fakeApiClient(async () => ({
          ok: true,
          token: 'tok123',
          reviewerId: 7,
          role: 'reviewer',
        }))}
      >
        <Consumer />
      </AuthProvider>,
    );

    await user.click(screen.getByText('login'));

    expect(screen.getByTestId('session').textContent).toBe(
      JSON.stringify({ token: 'tok123', reviewerId: 7, role: 'reviewer' }),
    );
  });

  it('leaves the session empty when login fails', async () => {
    const user = userEvent.setup();
    render(
      <AuthProvider apiClient={fakeApiClient(async () => ({ ok: false, reason: 'invalid_credentials' }))}>
        <Consumer />
      </AuthProvider>,
    );

    await user.click(screen.getByText('login'));

    expect(screen.getByTestId('session').textContent).toBe('none');
  });

  it('clears the session on logout', async () => {
    const user = userEvent.setup();
    render(
      <AuthProvider
        apiClient={fakeApiClient(async () => ({
          ok: true,
          token: 'tok123',
          reviewerId: 7,
          role: 'reviewer',
        }))}
      >
        <Consumer />
      </AuthProvider>,
    );

    await user.click(screen.getByText('login'));
    expect(screen.getByTestId('session').textContent).not.toBe('none');

    await user.click(screen.getByText('logout'));
    expect(screen.getByTestId('session').textContent).toBe('none');
  });

  it('throws when useAuth is called outside AuthProvider', () => {
    function Bare() {
      useAuth();
      return null;
    }
    // Suppress the expected React error-boundary console noise for this one assertion.
    const spy = () => {};
    const originalError = console.error;
    console.error = spy;
    try {
      expect(() => render(<Bare />)).toThrow(/AuthProvider/);
    } finally {
      console.error = originalError;
    }
  });
});
