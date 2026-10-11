import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChangePasswordForm } from './ChangePasswordForm';

async function fill(current: string, next: string, confirm: string) {
  const user = userEvent.setup({ delay: null });
  if (current) {
    await user.click(screen.getByLabelText('Current password'));
    await user.paste(current);
  }
  if (next) {
    await user.click(screen.getByLabelText('New password'));
    await user.paste(next);
  }
  if (confirm) {
    await user.click(screen.getByLabelText('Confirm new password'));
    await user.paste(confirm);
  }
  await user.click(screen.getByRole('button', { name: /save password/i }));
}

describe('ChangePasswordForm', () => {
  it('explains a forced change', () => {
    render(<ChangePasswordForm forced onSubmit={vi.fn()} />);
    expect(screen.getByRole('heading', { name: /choose your password/i })).toBeTruthy();
    expect(screen.getByText(/temporary password/i, { selector: 'p' })).toBeTruthy();
  });

  it('submits both passwords when they pass the checks', async () => {
    const onSubmit = vi.fn(async () => ({ ok: true as const }));
    render(<ChangePasswordForm forced={false} onSubmit={onSubmit} />);

    await fill('TempPass2345', 'my-own-secret', 'my-own-secret');

    expect(onSubmit).toHaveBeenCalledWith('TempPass2345', 'my-own-secret');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('refuses a new password shorter than 8 characters without submitting', async () => {
    const onSubmit = vi.fn();
    render(<ChangePasswordForm forced={false} onSubmit={onSubmit} />);

    await fill('TempPass2345', 'short', 'short');

    expect(screen.getByRole('alert').textContent).toMatch(/at least 8/);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('refuses mismatched confirmation without submitting', async () => {
    const onSubmit = vi.fn();
    render(<ChangePasswordForm forced={false} onSubmit={onSubmit} />);

    await fill('TempPass2345', 'my-own-secret', 'my-own-secreT');

    expect(screen.getByRole('alert').textContent).toMatch(/do not match/);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('refuses reusing the current password without submitting', async () => {
    const onSubmit = vi.fn();
    render(<ChangePasswordForm forced={false} onSubmit={onSubmit} />);

    await fill('my-own-secret', 'my-own-secret', 'my-own-secret');

    expect(screen.getByRole('alert').textContent).toMatch(/different/);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows the message from a failed submit', async () => {
    render(
      <ChangePasswordForm
        forced
        onSubmit={async () => ({ ok: false, message: 'That temporary password is not correct.' })}
      />,
    );

    await fill('wrong', 'my-own-secret', 'my-own-secret');

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('That temporary password is not correct.'),
    );
  });
});
