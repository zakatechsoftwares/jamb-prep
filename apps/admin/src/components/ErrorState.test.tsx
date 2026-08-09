import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ErrorState } from './ErrorState';

describe('ErrorState', () => {
  it('shows the message it is given', () => {
    render(<ErrorState message="could not reach the server" onRetry={() => {}} />);
    expect(screen.getByText('could not reach the server')).toBeTruthy();
  });

  it('calls onRetry when tapped', async () => {
    const user = userEvent.setup();
    let called = false;
    render(<ErrorState message="boom" onRetry={() => (called = true)} />);

    await user.click(screen.getByRole('button'));
    expect(called).toBe(true);
  });
});
