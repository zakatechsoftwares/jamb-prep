import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EmptyQueueState } from './EmptyQueueState';

describe('EmptyQueueState', () => {
  it('says nothing is available, not that something went wrong', () => {
    render(<EmptyQueueState onRetry={() => {}} />);
    expect(screen.getByText(/nothing to review/i)).toBeTruthy();
  });

  it('calls onRetry when the reviewer taps to check again', async () => {
    const user = userEvent.setup();
    let called = false;
    render(<EmptyQueueState onRetry={() => (called = true)} />);

    await user.click(screen.getByRole('button'));
    expect(called).toBe(true);
  });
});
