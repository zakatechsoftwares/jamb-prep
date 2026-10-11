import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ApiClient } from '../../../src/lib/api-client';
import { AuthProvider, type AuthSession } from '../../../src/auth/AuthProvider';
import ContentLeadReviewersPage from './page';

const replace = vi.fn();
const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push }),
}));

const LEAD: AuthSession = {
  token: 'tok123',
  reviewerId: 1,
  role: 'content_lead',
  mustChangePassword: false,
};

function fakeClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    listReviewerAccounts: vi.fn(async () => ({ ok: true as const, accounts: [] })),
    listSubjects: vi.fn(async () => ({
      ok: true as const,
      subjects: [{ id: 2, name: 'Physics' }],
    })),
    createReviewerAccount: vi.fn(async () => ({
      ok: true as const,
      reviewerId: 4,
      temporaryPassword: 'TempPass2345',
    })),
    ...overrides,
  } as unknown as ApiClient;
}

describe('ContentLeadReviewersPage', () => {
  beforeEach(() => {
    replace.mockClear();
    push.mockClear();
  });

  it('redirects to /login when there is no session', () => {
    render(
      <AuthProvider apiClient={fakeClient()}>
        <ContentLeadReviewersPage />
      </AuthProvider>,
    );
    expect(replace).toHaveBeenCalledWith('/login');
  });

  it('redirects a non-content-lead session away without ever calling the account routes', async () => {
    const client = fakeClient();
    render(
      <AuthProvider apiClient={client} initialSession={{ ...LEAD, role: 'moderator' }}>
        <ContentLeadReviewersPage />
      </AuthProvider>,
    );

    expect(replace).toHaveBeenCalledWith('/');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(client.listReviewerAccounts).not.toHaveBeenCalled();
    expect(client.listSubjects).not.toHaveBeenCalled();
  });

  it('creates an account and shows its temporary password once', async () => {
    const user = userEvent.setup({ delay: null });
    const client = fakeClient();
    render(
      <AuthProvider apiClient={client} initialSession={LEAD}>
        <ContentLeadReviewersPage />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByLabelText('Physics')).toBeTruthy());
    await user.click(screen.getByLabelText('Full name'));
    await user.paste('Adaeze Okafor');
    await user.click(screen.getByLabelText('Phone'));
    await user.paste('+2348031234567');
    await user.click(screen.getByLabelText('Email'));
    await user.paste('adaeze@example.test');
    await user.click(screen.getByLabelText('Physics'));
    await user.click(screen.getByRole('button', { name: /create account/i }));

    const notice = await screen.findByRole('status', { name: /temporary password/i });
    expect(notice.textContent).toContain('TempPass2345');
    expect(notice.textContent).toContain('adaeze@example.test');
    expect(client.createReviewerAccount).toHaveBeenCalledWith('tok123', {
      fullName: 'Adaeze Okafor',
      phone: '+2348031234567',
      email: 'adaeze@example.test',
      role: 'reviewer',
      subjectIds: [2],
    });
    // The list is refreshed so the new account appears.
    await waitFor(() => expect(client.listReviewerAccounts).toHaveBeenCalledTimes(2));

    await user.click(screen.getByRole('button', { name: /done/i }));
    expect(screen.queryByText('TempPass2345')).toBeNull();
  });

  it('shows a reset password in the same notice', async () => {
    const user = userEvent.setup({ delay: null });
    const client = fakeClient({
      listReviewerAccounts: vi.fn(async () => ({
        ok: true as const,
        accounts: [
          {
            reviewerId: 4,
            fullName: 'Adaeze Okafor',
            phone: '+2348031234567',
            email: null,
            role: 'reviewer' as const,
            status: 'active' as const,
            subjects: [],
            mustChangePassword: false,
            createdAt: '2026-10-11T09:00:00.000Z',
          },
        ],
      })),
      resetReviewerPassword: vi.fn(async () => ({
        ok: true as const,
        temporaryPassword: 'FreshPass678',
      })),
    });
    render(
      <AuthProvider apiClient={client} initialSession={LEAD}>
        <ContentLeadReviewersPage />
      </AuthProvider>,
    );

    await user.click(await screen.findByRole('button', { name: /reset password/i }));

    const notice = await screen.findByRole('status', { name: /temporary password/i });
    expect(notice.textContent).toContain('FreshPass678');
    // No email on file: the notice falls back to the phone number.
    expect(notice.textContent).toContain('+2348031234567');
    expect(client.resetReviewerPassword).toHaveBeenCalledWith('tok123', 4);
  });
});
