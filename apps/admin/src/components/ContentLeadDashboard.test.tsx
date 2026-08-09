import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ContentDashboard } from '@jamb/shared';
import { ContentLeadDashboard } from './ContentLeadDashboard';

const DASHBOARD: ContentDashboard = {
  acceptedItemsPerReviewerHour: 4.25,
  rejectionReasons: [
    { subjectId: 1, week: new Date('2026-01-05'), rejectionReason: 'implausible_distractor', count: 3 },
    { subjectId: 1, week: new Date('2026-01-12'), rejectionReason: 'implausible_distractor', count: 6 },
    { subjectId: 1, week: new Date('2026-01-12'), rejectionReason: 'wrong_key', count: 2 },
    { subjectId: 2, week: new Date('2026-01-12'), rejectionReason: 'off_syllabus', count: 4 },
  ],
  queueDepth: [{ subjectId: 1, depth: 12 }],
  itemsByState: [{ status: 'pending_review', count: 12 }],
  costPerApprovedItem: { approvedCount: 40, avgInferenceCostUsd: 0.0234, avgReviewerFeesKobo: 5250 },
  interRaterAgreement: [{ subjectId: 1, pairCount: 8, agreementRate: 0.625 }],
};

describe('ContentLeadDashboard', () => {
  it('renders the headline metrics', () => {
    render(<ContentLeadDashboard dashboard={DASHBOARD} />);

    expect(screen.getByText('4.25')).toBeTruthy();
    expect(screen.getByText('40')).toBeTruthy();
    expect(screen.getByText('$0.0234')).toBeTruthy();
    expect(screen.getByText('₦52.50')).toBeTruthy();
  });

  it('surfaces the window-wide dominant rejection reason as "fix next", not merely the first row', () => {
    render(<ContentLeadDashboard dashboard={DASHBOARD} />);

    // implausible_distractor totals 3 + 6 = 9 across the two weeks, beating
    // any single row's count (including off_syllabus's 4) — this is only
    // correct if the component aggregates across weeks rather than reading
    // the first array entry.
    const topDefect = screen.getByTestId('top-defect');
    expect(topDefect.textContent).toContain('Subject #1');
    expect(topDefect.textContent).toContain('implausible_distractor');
    expect(topDefect.textContent).toContain('9');
  });

  it('renders "no rejections" when the window has none', () => {
    render(<ContentLeadDashboard dashboard={{ ...DASHBOARD, rejectionReasons: [] }} />);
    expect(screen.getByText(/no rejections in this window/i)).toBeTruthy();
  });

  it('renders queue depth, items by state, and inter-rater agreement', () => {
    render(<ContentLeadDashboard dashboard={DASHBOARD} />);

    expect(screen.getByText(/subject #1: 12/i)).toBeTruthy();
    expect(screen.getByText(/pending_review: 12/i)).toBeTruthy();
    expect(screen.getByText(/subject #1: 63% \(8 pairs\)/i)).toBeTruthy();
  });
});
