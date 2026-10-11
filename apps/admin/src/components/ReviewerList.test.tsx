import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReviewerAccountSummary } from '@jamb/shared';
import { ReviewerList } from './ReviewerList';

function account(overrides: Partial<ReviewerAccountSummary>): ReviewerAccountSummary {
  return {
    reviewerId: 1,
    fullName: 'Adaeze Okafor',
    phone: '+2348031234567',
    email: 'adaeze@example.test',
    role: 'reviewer',
    status: 'active',
    subjects: [{ id: 2, name: 'Physics' }],
    mustChangePassword: false,
    createdAt: '2026-10-11T09:00:00.000Z',
    ...overrides,
  };
}

describe('ReviewerList', () => {
  it('offers reset and suspend for an active reviewer, calling back with the account', async () => {
    const user = userEvent.setup({ delay: null });
    const onResetPassword = vi.fn();
    const onSetStatus = vi.fn();
    const active = account({});
    render(
      <ReviewerList accounts={[active]} onResetPassword={onResetPassword} onSetStatus={onSetStatus} />,
    );

    await user.click(screen.getByRole('button', { name: /reset password/i }));
    await user.click(screen.getByRole('button', { name: /suspend/i }));

    expect(onResetPassword).toHaveBeenCalledWith(active);
    expect(onSetStatus).toHaveBeenCalledWith(active, 'suspended');
  });

  it('offers reactivate for a suspended reviewer', async () => {
    const user = userEvent.setup({ delay: null });
    const onSetStatus = vi.fn();
    const suspended = account({ status: 'suspended' });
    render(<ReviewerList accounts={[suspended]} onResetPassword={vi.fn()} onSetStatus={onSetStatus} />);

    await user.click(screen.getByRole('button', { name: /reactivate/i }));
    expect(onSetStatus).toHaveBeenCalledWith(suspended, 'active');
  });

  it('shows no actions for a content lead or a removed reviewer', () => {
    render(
      <ReviewerList
        accounts={[
          account({ reviewerId: 1, fullName: 'Lead Person', role: 'content_lead' }),
          account({ reviewerId: 2, fullName: 'Removed Person', status: 'removed' }),
        ]}
        onResetPassword={vi.fn()}
        onSetStatus={vi.fn()}
      />,
    );

    for (const name of ['Lead Person', 'Removed Person']) {
      expect(within(screen.getByRole('listitem', { name })).queryAllByRole('button')).toEqual([]);
    }
  });

  it('flags an account that still holds a temporary password', () => {
    render(
      <ReviewerList
        accounts={[account({ mustChangePassword: true })]}
        onResetPassword={vi.fn()}
        onSetStatus={vi.fn()}
      />,
    );
    expect(screen.getByText(/has not yet chosen their own password/i)).toBeTruthy();
  });

  it('disables the buttons of the account an action is in flight for', () => {
    render(
      <ReviewerList
        accounts={[account({ reviewerId: 9 })]}
        onResetPassword={vi.fn()}
        onSetStatus={vi.fn()}
        busyReviewerId={9}
      />,
    );
    expect(
      screen.getByRole('button', { name: /reset password/i }).hasAttribute('disabled'),
    ).toBe(true);
  });
});
