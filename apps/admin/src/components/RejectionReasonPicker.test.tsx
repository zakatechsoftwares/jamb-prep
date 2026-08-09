import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { REJECTION_REASONS } from '@jamb/shared';
import { RejectionReasonPicker } from './RejectionReasonPicker';

describe('RejectionReasonPicker', () => {
  it('offers every reason in the fixed taxonomy, and nothing else — no free text', () => {
    render(<RejectionReasonPicker pending={false} onChoose={() => {}} onCancel={() => {}} />);

    for (const reason of REJECTION_REASONS) {
      expect(screen.getByRole('button', { name: new RegExp(reason.replace(/_/g, ' '), 'i') })).toBeTruthy();
    }
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('calls onChoose with the tapped reason — a single tap is the whole interaction', async () => {
    const user = userEvent.setup();
    let chosen: string | null = null;
    render(
      <RejectionReasonPicker pending={false} onChoose={(reason) => (chosen = reason)} onCancel={() => {}} />,
    );

    await user.click(screen.getByText(/wrong key/i));
    expect(chosen).toBe('wrong_key');
  });

  it('calls onCancel when the reviewer backs out', async () => {
    const user = userEvent.setup();
    let cancelled = false;
    render(
      <RejectionReasonPicker pending={false} onChoose={() => {}} onCancel={() => (cancelled = true)} />,
    );

    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(cancelled).toBe(true);
  });

  it('disables every reason while pending, so a double tap cannot double-submit', () => {
    render(<RejectionReasonPicker pending={true} onChoose={() => {}} onCancel={() => {}} />);

    for (const reason of REJECTION_REASONS) {
      const button = screen.getByRole('button', { name: new RegExp(reason.replace(/_/g, ' '), 'i') });
      expect(button.hasAttribute('disabled')).toBe(true);
    }
  });
});
