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

  describe('offline status (session 08)', () => {
    it('shows nothing extra when online with nothing cached or queued', () => {
      render(<ReviewHeader reviewedThisSession={0} isOnline cachedItemCount={0} pendingDecisionCount={0} />);
      expect(screen.queryByText(/offline/i)).toBeNull();
      expect(screen.queryByText(/cached/i)).toBeNull();
      expect(screen.queryByText(/pending upload/i)).toBeNull();
    });

    it('shows an offline indicator when disconnected', () => {
      render(
        <ReviewHeader
          reviewedThisSession={0}
          isOnline={false}
          cachedItemCount={0}
          pendingDecisionCount={0}
        />,
      );
      expect(screen.getByText(/offline/i)).toBeTruthy();
    });

    it('shows how many items are cached', () => {
      render(
        <ReviewHeader reviewedThisSession={0} isOnline cachedItemCount={7} pendingDecisionCount={0} />,
      );
      expect(screen.getByText('7')).toBeTruthy();
      expect(screen.getByText(/cached/i)).toBeTruthy();
    });

    it('shows how many decisions are pending upload', () => {
      render(
        <ReviewHeader reviewedThisSession={0} isOnline cachedItemCount={0} pendingDecisionCount={4} />,
      );
      expect(screen.getByText('4')).toBeTruthy();
      expect(screen.getByText(/pending upload/i)).toBeTruthy();
    });

    it('shows when the earliest cached claim expires', () => {
      render(
        <ReviewHeader
          reviewedThisSession={0}
          isOnline
          cachedItemCount={2}
          pendingDecisionCount={0}
          nextClaimExpiry={new Date('2026-08-09T12:34:00Z')}
        />,
      );
      expect(screen.getByText(/expires/i)).toBeTruthy();
    });

    it('counts a decision the server recorded as a late-arriving second opinion, without hiding it', () => {
      render(
        <ReviewHeader
          reviewedThisSession={1}
          isOnline
          cachedItemCount={0}
          pendingDecisionCount={0}
          lateArrivalCount={2}
        />,
      );
      expect(screen.getByText('2')).toBeTruthy();
      expect(screen.getByText(/second opinion/i)).toBeTruthy();
    });
  });
});
