import { describe, expect, it } from 'vitest';
import {
  QUEUE_PRIORITIES,
  compareQueueEntries,
  isEligibleForReviewer,
  priorityOf,
  requiresHumanReview,
  shouldSampleForReview,
  shouldServeGoldItem,
  validateReviewQueueConfig,
  type QueueCandidate,
  type QueueReviewer,
  type ReviewQueueConfig,
} from './review-queue-policy';

const CREATED = new Date('2026-05-01T08:00:00.000Z');

const REVIEWER: QueueReviewer = { reviewerUserId: 11, subjectIds: [1, 2] };

/**
 * A plainly queueable item: sampled low risk, agreed solve, awaiting a
 * first review. Every test below varies one fact from this baseline.
 */
const BASELINE: QueueCandidate = {
  itemId: 100,
  subjectId: 1,
  status: 'pending_review',
  riskTier: 'low',
  independentSolveVerdict: 'agreed',
  gateFlagged: false,
  sampledForReview: true,
  contributorUserId: null,
  decidedByUserIds: [],
  createdAt: CREATED,
};

function candidate(overrides: Partial<QueueCandidate> = {}): QueueCandidate {
  return { ...BASELINE, ...overrides };
}

/** A generator returning a fixed draw, so no test depends on real randomness. */
function fixedRng(value: number): () => number {
  return () => value;
}

const VALID_CONFIG: ReviewQueueConfig = {
  goldItemRate: 0.05,
  lowRiskSampleRate: 0.3,
  claimDurationMinutes: 30,
  batchMaxSize: 25,
};

// ---------------------------------------------------------------------------
// Priority bands (plan 7.9 queue prioritisation)
// ---------------------------------------------------------------------------

describe('priorityOf', () => {
  it('puts a disagreed independent solve at the top of the queue', () => {
    // 7.9: a disagreed verdict is evidence this specific item is probably
    // wrong. A concrete suspected error outranks a merely risky category.
    expect(priorityOf(candidate({ independentSolveVerdict: 'disagreed' }))).toBe(
      QUEUE_PRIORITIES.disagreedSolve,
    );
  });

  it('ranks a disagreed solve above a high risk_tier item', () => {
    const disagreedAndHigh = candidate({
      independentSolveVerdict: 'disagreed',
      riskTier: 'high',
    });

    expect(priorityOf(disagreedAndHigh)).toBe(QUEUE_PRIORITIES.disagreedSolve);
  });

  it('ranks high risk_tier items second', () => {
    expect(priorityOf(candidate({ riskTier: 'high' }))).toBe(QUEUE_PRIORITIES.highRisk);
  });

  it('ranks a high risk_tier item above one merely awaiting a second review', () => {
    const highAndSecond = candidate({ riskTier: 'high', status: 'needs_second_review' });

    expect(priorityOf(highAndSecond)).toBe(QUEUE_PRIORITIES.highRisk);
  });

  it('ranks needs_second_review third', () => {
    expect(priorityOf(candidate({ status: 'needs_second_review' }))).toBe(
      QUEUE_PRIORITIES.secondReview,
    );
  });

  it('ranks gate-flagged items fourth', () => {
    expect(priorityOf(candidate({ gateFlagged: true }))).toBe(QUEUE_PRIORITIES.gateFlagged);
  });

  it('ranks a second review above a gate-flagged item', () => {
    const secondAndFlagged = candidate({ status: 'needs_second_review', gateFlagged: true });

    expect(priorityOf(secondAndFlagged)).toBe(QUEUE_PRIORITIES.secondReview);
  });

  it('ranks a sampled low-risk item last', () => {
    expect(priorityOf(candidate())).toBe(QUEUE_PRIORITIES.sampledLowRisk);
  });

  it('ranks a human-authored contribution in the ordinary band', () => {
    // 7.12 step 6: a commissioned item enters the ordinary review queue.
    // The five bands in 7.9 do not name it, so it falls to the last band
    // rather than jumping the queue ahead of suspected errors.
    expect(priorityOf(candidate({ riskTier: 'not_generated', sampledForReview: false }))).toBe(
      QUEUE_PRIORITIES.sampledLowRisk,
    );
  });

  it('throws when asked to rank an item that is not awaiting review', () => {
    expect(() => priorityOf(candidate({ status: 'approved_uncalibrated' }))).toThrow(/status/i);
    expect(() => priorityOf(candidate({ status: 'generated' }))).toThrow(/status/i);
  });

  it('throws when asked to rank an item bound for the automated route', () => {
    // Low risk, unsampled, agreed: 7.14 says no human ever needs to see
    // it. Ranking it means it leaked into the queue, which is a caller bug
    // worth surfacing rather than quietly serving to a reviewer.
    const autoBound = candidate({ sampledForReview: false });

    expect(() => priorityOf(autoBound)).toThrow(/automated route/i);
  });
});

// ---------------------------------------------------------------------------
// Which items belong in the queue at all
// ---------------------------------------------------------------------------

describe('requiresHumanReview', () => {
  it('keeps an unsampled low-risk item with an agreed solve out of the queue', () => {
    expect(requiresHumanReview(candidate({ sampledForReview: false }))).toBe(false);
  });

  it('queues an unsampled low-risk item whose independent solve disagreed', () => {
    // The sampling draw does not get to exempt an item the blind solve
    // flagged. 7.14 requires a human decision on every disagreement,
    // sampled or not — filtering on the draw alone would lose it.
    const disagreedUnsampled = candidate({
      sampledForReview: false,
      independentSolveVerdict: 'disagreed',
    });

    expect(requiresHumanReview(disagreedUnsampled)).toBe(true);
    expect(priorityOf(disagreedUnsampled)).toBe(QUEUE_PRIORITIES.disagreedSolve);
  });

  it('queues an unsampled low-risk item that a gate flagged', () => {
    // An item a gate flagged did not pass the gates cleanly, so it cannot
    // take the route that presumes it did.
    const flaggedUnsampled = candidate({ sampledForReview: false, gateFlagged: true });

    expect(requiresHumanReview(flaggedUnsampled)).toBe(true);
    expect(priorityOf(flaggedUnsampled)).toBe(QUEUE_PRIORITIES.gateFlagged);
  });

  it('queues an item awaiting a second review whatever its other facts', () => {
    const secondReview = candidate({ sampledForReview: false, status: 'needs_second_review' });

    expect(requiresHumanReview(secondReview)).toBe(true);
  });

  it('queues a sampled low-risk item', () => {
    expect(requiresHumanReview(candidate())).toBe(true);
  });

  it('queues every high risk_tier item', () => {
    expect(requiresHumanReview(candidate({ riskTier: 'high', sampledForReview: false }))).toBe(
      true,
    );
  });

  it('queues a human-authored item, which is never eligible for the automated route', () => {
    expect(
      requiresHumanReview(candidate({ riskTier: 'not_generated', sampledForReview: false })),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Exclusions — who may not be shown which item
// ---------------------------------------------------------------------------

describe('isEligibleForReviewer', () => {
  it('offers an ordinary queued item in the reviewer’s subject', () => {
    expect(isEligibleForReviewer(candidate(), REVIEWER)).toBe(true);
  });

  it('excludes an item outside the reviewer’s subjects', () => {
    expect(isEligibleForReviewer(candidate({ subjectId: 99 }), REVIEWER)).toBe(false);
  });

  it('excludes an item the reviewer authored', () => {
    const own = candidate({ contributorUserId: REVIEWER.reviewerUserId });

    expect(isEligibleForReviewer(own, REVIEWER)).toBe(false);
  });

  it('excludes an item the reviewer has already decided on', () => {
    const decided = candidate({ decidedByUserIds: [REVIEWER.reviewerUserId] });

    expect(isEligibleForReviewer(decided, REVIEWER)).toBe(false);
  });

  it('excludes a second review from the reviewer who made the first decision', () => {
    // The same exclusion, at the point where it matters most: 7.10's second
    // opinion is a second *independent* reviewer.
    const secondReview = candidate({
      status: 'needs_second_review',
      decidedByUserIds: [REVIEWER.reviewerUserId],
    });

    expect(isEligibleForReviewer(secondReview, REVIEWER)).toBe(false);
  });

  it('offers a second review to a reviewer who has not yet decided on it', () => {
    const secondReview = candidate({ status: 'needs_second_review', decidedByUserIds: [12] });

    expect(isEligibleForReviewer(secondReview, REVIEWER)).toBe(true);
  });

  it('excludes an item that does not require human review at all', () => {
    expect(isEligibleForReviewer(candidate({ sampledForReview: false }), REVIEWER)).toBe(false);
  });

  it('excludes an item that is not awaiting review', () => {
    expect(isEligibleForReviewer(candidate({ status: 'in_review' }), REVIEWER)).toBe(false);
    expect(isEligibleForReviewer(candidate({ status: 'approved_calibrated' }), REVIEWER)).toBe(
      false,
    );
  });

  it('excludes a reviewer with no subjects from everything', () => {
    const noSubjects: QueueReviewer = { reviewerUserId: 11, subjectIds: [] };

    expect(isEligibleForReviewer(candidate(), noSubjects)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Gold items are excluded on exactly the same terms
// ---------------------------------------------------------------------------

describe('gold item exclusions', () => {
  it('excludes a gold item the reviewer has already decided on', () => {
    // A gold item is an ordinary item with a known reference decision, so
    // it takes the same exclusions. Serving one twice would count a single
    // judgement twice in the reviewer's accuracy score (7.11), quietly
    // corrupting the measure the whole quality system rests on.
    const decidedGold = candidate({ isGold: true, decidedByUserIds: [REVIEWER.reviewerUserId] });

    expect(isEligibleForReviewer(decidedGold, REVIEWER)).toBe(false);
  });

  it('excludes a gold item the reviewer authored', () => {
    const ownGold = candidate({ isGold: true, contributorUserId: REVIEWER.reviewerUserId });

    expect(isEligibleForReviewer(ownGold, REVIEWER)).toBe(false);
  });

  it('excludes a gold item outside the reviewer’s subjects', () => {
    expect(isEligibleForReviewer(candidate({ isGold: true, subjectId: 99 }), REVIEWER)).toBe(false);
  });

  it('offers a gold item the reviewer has not seen, like any other', () => {
    expect(isEligibleForReviewer(candidate({ isGold: true }), REVIEWER)).toBe(true);
  });

  it('ranks a gold item by its own facts, so it cannot be spotted by its position', () => {
    // Measurement is invisible (7.11). If gold items always arrived first,
    // or always last, a reviewer would learn to recognise them and the
    // measure would stop measuring anything.
    expect(priorityOf(candidate({ isGold: true }))).toBe(priorityOf(candidate()));
    expect(priorityOf(candidate({ isGold: true, riskTier: 'high' }))).toBe(
      priorityOf(candidate({ riskTier: 'high' })),
    );
  });
});

// ---------------------------------------------------------------------------
// Ordering within and across bands
// ---------------------------------------------------------------------------

describe('compareQueueEntries', () => {
  const older = candidate({ itemId: 1, createdAt: new Date('2026-05-01T08:00:00.000Z') });
  const newer = candidate({ itemId: 2, createdAt: new Date('2026-05-02T08:00:00.000Z') });

  it('orders a higher priority band ahead of a lower one', () => {
    const highRisk = candidate({ itemId: 3, riskTier: 'high', createdAt: newer.createdAt });

    expect(compareQueueEntries(highRisk, older)).toBeLessThan(0);
    expect(compareQueueEntries(older, highRisk)).toBeGreaterThan(0);
  });

  it('orders the older item first within a band', () => {
    expect(compareQueueEntries(older, newer)).toBeLessThan(0);
    expect(compareQueueEntries(newer, older)).toBeGreaterThan(0);
  });

  it('breaks a tie on identical timestamps by item id, so the order is total', () => {
    // Two items generated in the same batch can share a created_at to the
    // millisecond. Without a final tiebreak the order is whatever the plan
    // happens to produce, which makes the queue untestable.
    const a = candidate({ itemId: 7, createdAt: CREATED });
    const b = candidate({ itemId: 8, createdAt: CREATED });

    expect(compareQueueEntries(a, b)).toBeLessThan(0);
    expect(compareQueueEntries(b, a)).toBeGreaterThan(0);
    expect(compareQueueEntries(a, a)).toBe(0);
  });

  it('does not starve the ordinary band during a wave of urgent items', () => {
    // A generation wave floods bands 1 and 2. The ordinary band must still
    // drain oldest-first rather than being reshuffled or held back
    // indefinitely behind newer urgent work.
    const wave = [
      candidate({ itemId: 50, riskTier: 'high', createdAt: new Date('2026-06-01T00:00:00.000Z') }),
      candidate({ itemId: 51, riskTier: 'high', createdAt: new Date('2026-06-02T00:00:00.000Z') }),
    ];
    const waiting = [
      candidate({ itemId: 10, createdAt: new Date('2026-01-02T00:00:00.000Z') }),
      candidate({ itemId: 11, createdAt: new Date('2026-01-01T00:00:00.000Z') }),
    ];

    const ordered = [...wave, ...waiting].sort(compareQueueEntries).map((entry) => entry.itemId);

    expect(ordered).toEqual([50, 51, 11, 10]);
  });

  it('sorts a mixed queue into full band order, oldest first inside each band', () => {
    const entries = [
      candidate({ itemId: 1, createdAt: new Date('2026-03-01T00:00:00.000Z') }),
      candidate({ itemId: 2, gateFlagged: true, createdAt: new Date('2026-03-02T00:00:00.000Z') }),
      candidate({
        itemId: 3,
        status: 'needs_second_review',
        createdAt: new Date('2026-03-03T00:00:00.000Z'),
      }),
      candidate({ itemId: 4, riskTier: 'high', createdAt: new Date('2026-03-04T00:00:00.000Z') }),
      candidate({
        itemId: 5,
        independentSolveVerdict: 'disagreed',
        createdAt: new Date('2026-03-05T00:00:00.000Z'),
      }),
      candidate({ itemId: 6, riskTier: 'high', createdAt: new Date('2026-01-01T00:00:00.000Z') }),
    ];

    const ordered = [...entries].sort(compareQueueEntries).map((entry) => entry.itemId);

    expect(ordered).toEqual([5, 6, 4, 3, 2, 1]);
  });
});

// ---------------------------------------------------------------------------
// Configured rates — gold injection and the sampling draw
// ---------------------------------------------------------------------------

describe('shouldServeGoldItem', () => {
  it('serves a gold item when the draw falls below the configured rate', () => {
    expect(shouldServeGoldItem(0.1, fixedRng(0.05))).toBe(true);
  });

  it('serves an ordinary item when the draw is above the rate', () => {
    expect(shouldServeGoldItem(0.1, fixedRng(0.15))).toBe(false);
  });

  it('treats a draw exactly on the rate as ordinary', () => {
    // Strictly below, so rate 0 never fires and rate 1 always does.
    expect(shouldServeGoldItem(0.1, fixedRng(0.1))).toBe(false);
  });

  it('never serves gold at a rate of zero', () => {
    expect(shouldServeGoldItem(0, fixedRng(0))).toBe(false);
  });

  it('always serves gold at a rate of one', () => {
    expect(shouldServeGoldItem(1, fixedRng(0.999999))).toBe(true);
  });

  it('throws on a rate outside zero to one', () => {
    expect(() => shouldServeGoldItem(-0.1, fixedRng(0.5))).toThrow(/rate/i);
    expect(() => shouldServeGoldItem(1.1, fixedRng(0.5))).toThrow(/rate/i);
    expect(() => shouldServeGoldItem(Number.NaN, fixedRng(0.5))).toThrow(/rate/i);
  });

  it('throws when the generator returns a value outside zero to one', () => {
    // A broken generator would otherwise silently skew the rate, and the
    // measurement it feeds is meant to be trustworthy.
    expect(() => shouldServeGoldItem(0.5, fixedRng(1))).toThrow(/random|generator|draw/i);
    expect(() => shouldServeGoldItem(0.5, fixedRng(-0.1))).toThrow(/random|generator|draw/i);
    expect(() => shouldServeGoldItem(0.5, fixedRng(Number.NaN))).toThrow(/random|generator|draw/i);
  });
});

describe('shouldSampleForReview', () => {
  // Written now, called by the generation pipeline in a later session. The
  // rule is tested here rather than left notional until then.
  it('selects an item when the draw falls below the configured rate', () => {
    expect(shouldSampleForReview(0.3, fixedRng(0.29))).toBe(true);
  });

  it('leaves an item unsampled when the draw is above the rate', () => {
    expect(shouldSampleForReview(0.3, fixedRng(0.31))).toBe(false);
  });

  it('samples nothing at a rate of zero and everything at a rate of one', () => {
    expect(shouldSampleForReview(0, fixedRng(0))).toBe(false);
    expect(shouldSampleForReview(1, fixedRng(0.999999))).toBe(true);
  });

  it('throws on a rate outside zero to one', () => {
    // Guards the 30-vs-0.3 confusion directly: a percentage passed here
    // would sample the entire bank and silently bankrupt the review budget.
    expect(() => shouldSampleForReview(30, fixedRng(0.5))).toThrow(/rate/i);
    expect(() => shouldSampleForReview(-1, fixedRng(0.5))).toThrow(/rate/i);
  });

  it('throws when the generator returns a value outside zero to one', () => {
    expect(() => shouldSampleForReview(0.5, fixedRng(1))).toThrow(/random|generator|draw/i);
  });
});

// ---------------------------------------------------------------------------
// Configuration, which is data rather than constants
// ---------------------------------------------------------------------------

describe('validateReviewQueueConfig', () => {
  it('accepts a well-formed config', () => {
    expect(() => validateReviewQueueConfig(VALID_CONFIG)).not.toThrow();
  });

  it('throws on a gold item rate outside zero to one', () => {
    expect(() => validateReviewQueueConfig({ ...VALID_CONFIG, goldItemRate: 1.5 })).toThrow(
      /goldItemRate/i,
    );
  });

  it('throws on a sample rate outside zero to one', () => {
    expect(() => validateReviewQueueConfig({ ...VALID_CONFIG, lowRiskSampleRate: 30 })).toThrow(
      /lowRiskSampleRate/i,
    );
  });

  it('throws on a non-positive claim duration', () => {
    // A zero-minute claim expires the instant it is taken, handing the same
    // item to the next reviewer while the first is still reading it.
    expect(() => validateReviewQueueConfig({ ...VALID_CONFIG, claimDurationMinutes: 0 })).toThrow(
      /claimDurationMinutes/i,
    );
    expect(() => validateReviewQueueConfig({ ...VALID_CONFIG, claimDurationMinutes: -5 })).toThrow(
      /claimDurationMinutes/i,
    );
  });

  it('throws on a fractional claim duration or batch size', () => {
    expect(() => validateReviewQueueConfig({ ...VALID_CONFIG, claimDurationMinutes: 1.5 })).toThrow(
      /claimDurationMinutes/i,
    );
    expect(() => validateReviewQueueConfig({ ...VALID_CONFIG, batchMaxSize: 2.5 })).toThrow(
      /batchMaxSize/i,
    );
  });

  it('throws on a non-positive batch size', () => {
    expect(() => validateReviewQueueConfig({ ...VALID_CONFIG, batchMaxSize: 0 })).toThrow(
      /batchMaxSize/i,
    );
  });
});
