import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReviewHeader } from './ReviewHeader';

describe('ReviewHeader', () => {
  it('shows the session-only reviewed count, honestly labeled', () => {
    render(<ReviewHeader reviewedThisSession={3} />);
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText(/this session/i)).toBeTruthy();
  });

  it('shows placeholders for accuracy and earnings, not fabricated numbers', () => {
    // Neither is trackable yet — session F / canonical session 09 is
    // unbuilt — so the header must not imply a real figure exists.
    render(<ReviewHeader reviewedThisSession={0} />);
    const dashes = screen.getAllByText('—');
    expect(dashes).toHaveLength(2);
  });
});
