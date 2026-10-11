import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ApiClient } from '../lib/api-client';
import { AuthProvider, type AuthSession } from '../auth/AuthProvider';
import { PasswordChangeGate } from './PasswordChangeGate';

const replace = vi.fn();
let pathname = '/';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => pathname,
}));

function renderGate(session: AuthSession | null) {
  render(
    <AuthProvider apiClient={{} as ApiClient} initialSession={session}>
      <PasswordChangeGate>
        <p>page content</p>
      </PasswordChangeGate>
    </AuthProvider>,
  );
}

const base: AuthSession = { token: 'tok', reviewerId: 7, role: 'reviewer', mustChangePassword: false };

describe('PasswordChangeGate', () => {
  beforeEach(() => {
    replace.mockClear();
    pathname = '/';
  });

  it('renders the page for a session that does not need a password change', () => {
    renderGate(base);
    expect(screen.queryByText('page content')).not.toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });

  it('renders the page with no session at all — signing in is the page’s own concern', () => {
    renderGate(null);
    expect(screen.queryByText('page content')).not.toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });

  it('withholds the page and redirects a must-change session', () => {
    renderGate({ ...base, mustChangePassword: true });
    expect(screen.queryByText('page content')).toBeNull();
    expect(replace).toHaveBeenCalledWith('/account/password');
  });

  it('lets a must-change session reach the change-password screen itself', () => {
    pathname = '/account/password';
    renderGate({ ...base, mustChangePassword: true });
    expect(screen.queryByText('page content')).not.toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });
});
