import type { IndependentSolveVerdict, ItemStatus, RiskTier } from './item-lifecycle';
import { qualifiesForAutomatedRoute } from './item-state-machine';

/**
 * The queue prioritisation in plan 7.9, lowest number served first. A
 * disagreed verdict is evidence that this specific item is probably wrong;
 * a high risk_tier only says the category is risky. A concrete suspected
 * error outranks a merely risky category.
 */
export const QUEUE_PRIORITIES = {
  disagreedSolve: 1,
  highRisk: 2,
  secondReview: 3,
  gateFlagged: 4,
  sampledLowRisk: 5,
} as const;

export type QueuePriority = (typeof QUEUE_PRIORITIES)[keyof typeof QUEUE_PRIORITIES];

/** The two states an item can be sitting in while it waits for a reviewer. */
const QUEUEABLE_STATUSES: readonly ItemStatus[] = ['pending_review', 'needs_second_review'];

/** The item facts the queue ranks and filters on. Read from the row. */
export interface QueueCandidate {
  itemId: number;
  subjectId: number;
  status: ItemStatus;
  riskTier: RiskTier;
  independentSolveVerdict: IndependentSolveVerdict;
  gateFlagged: boolean;
  sampledForReview: boolean;
  contributorUserId: number | null;
  /** Reviewers (by user id) who have already recorded a decision on it. */
  decidedByUserIds: number[];
  createdAt: Date;
  /** Seeded gold item (7.11). Never surfaced in an API response. */
  isGold?: boolean;
}

export interface QueueReviewer {
  reviewerUserId: number;
  subjectIds: number[];
}

export interface ReviewQueueConfig {
  goldItemRate: number;
  /**
   * A rate in [0, 1], deliberately not a percentage. Plan 7.3's "30-50%"
   * is 0.3-0.5 here — see packages/shared/README.md.
   */
  lowRiskSampleRate: number;
  claimDurationMinutes: number;
  batchMaxSize: number;
}

/**
 * One item as the reviewer workspace receives it.
 *
 * Carries no `is_correct` and no gold marker. Plan 7.10 requires the
 * reviewer to record their own answer before the proposed key is revealed —
 * the single highest-value control in the framework — so the key is absent
 * from this payload rather than present and merely not displayed. And a
 * seeded gold item (7.11) must be indistinguishable from an ordinary one,
 * which it can only be if nothing in this shape says which it is.
 */
export interface ReviewQueueItem {
  itemId: number;
  subjectId: number;
  objectiveId: number;
  stem: string;
  options: { label: string; text: string }[];
  cognitiveLevel: string;
  independentSolveVerdict: IndependentSolveVerdict;
  claimExpiresAt: Date;
}

/**
 * What the API needs from the queue. Defined here so `apps/api` can be
 * wired against it without importing the database layer at module load.
 */
export interface ReviewQueueService {
  getNextItem(reviewerId: number): Promise<ReviewQueueItem | null>;
  getNextItemBatch(reviewerId: number, count: number): Promise<ReviewQueueItem[]>;
}

/**
 * Whether this item needs a human at all, and so whether it belongs in the
 * queue.
 *
 * This is the negated 7.14 triple, not a filter on the sampling draw. An
 * item the blind solve disagreed with, or that a gate flagged, requires a
 * human decision whether or not the draw selected it — filtering on the
 * draw alone would silently drop the highest-priority items in the queue.
 */
export function requiresHumanReview(candidate: QueueCandidate): boolean {
  if (!QUEUEABLE_STATUSES.includes(candidate.status)) {
    return false;
  }

  // A second opinion was asked for; the draw has no say over that.
  if (candidate.status === 'needs_second_review') {
    return true;
  }

  // An item a gate flagged did not pass the gates cleanly, so it cannot
  // take the route that presumes it did.
  if (candidate.gateFlagged) {
    return true;
  }

  return !qualifiesForAutomatedRoute({
    contributorUserId: candidate.contributorUserId,
    riskTier: candidate.riskTier,
    independentSolveVerdict: candidate.independentSolveVerdict,
    sampledForReview: candidate.sampledForReview,
  });
}

/**
 * Which priority band an item falls into (7.9).
 *
 * Throws rather than returning a band for an item that should not be in the
 * queue: being asked to rank one means it leaked past the filter, which is
 * a caller bug worth surfacing rather than quietly serving to a reviewer.
 */
export function priorityOf(candidate: QueueCandidate): QueuePriority {
  if (!QUEUEABLE_STATUSES.includes(candidate.status)) {
    throw new Error(
      `priorityOf: item ${candidate.itemId} has status '${candidate.status}' and is not awaiting review — only ${QUEUEABLE_STATUSES.join(' and ')} items are queued`,
    );
  }

  if (!requiresHumanReview(candidate)) {
    throw new Error(
      `priorityOf: item ${candidate.itemId} qualifies for the automated route (7.14) and must never reach a reviewer's queue`,
    );
  }

  if (candidate.independentSolveVerdict === 'disagreed') {
    return QUEUE_PRIORITIES.disagreedSolve;
  }

  if (candidate.riskTier === 'high') {
    return QUEUE_PRIORITIES.highRisk;
  }

  if (candidate.status === 'needs_second_review') {
    return QUEUE_PRIORITIES.secondReview;
  }

  if (candidate.gateFlagged) {
    return QUEUE_PRIORITIES.gateFlagged;
  }

  // Sampled low-risk items and human-authored contributions alike (7.9,
  // sixth case). A commissioned item from a known author is a known
  // quantity; a disagreed verdict is an unknown defect, and goes first.
  return QUEUE_PRIORITIES.sampledLowRisk;
}

/**
 * Whether this item may be shown to this reviewer. Returns false rather
 * than throwing: "not for you" is an ordinary answer for a filter, unlike
 * being asked to rank something that should not be queued at all.
 *
 * Gold items (7.11) take exactly these exclusions. Serving one a reviewer
 * has already judged would count a single judgement twice in the accuracy
 * score the quality system rests on.
 */
export function isEligibleForReviewer(candidate: QueueCandidate, reviewer: QueueReviewer): boolean {
  if (!requiresHumanReview(candidate)) {
    return false;
  }

  if (!reviewer.subjectIds.includes(candidate.subjectId)) {
    return false;
  }

  // 7.10: contributors and reviewers are one pool, never on the same item.
  if (candidate.contributorUserId === reviewer.reviewerUserId) {
    return false;
  }

  // Covers the second-review case too: 7.10's second opinion comes from a
  // second *independent* reviewer.
  return !candidate.decidedByUserIds.includes(reviewer.reviewerUserId);
}

/**
 * Queue order: priority band, then oldest first within the band, then item
 * id.
 *
 * The age tiebreak is what stops the ordinary band starving during a
 * generation wave — without it, a flood of urgent items would keep
 * reordering the tail. The id tiebreak makes the order total: two items
 * generated in the same batch can share a created_at to the millisecond.
 */
export function compareQueueEntries(left: QueueCandidate, right: QueueCandidate): number {
  const byBand = priorityOf(left) - priorityOf(right);
  if (byBand !== 0) {
    return byBand;
  }

  const byAge = left.createdAt.getTime() - right.createdAt.getTime();
  if (byAge !== 0) {
    return byAge;
  }

  return left.itemId - right.itemId;
}

function assertRate(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(
      `${name} must be a rate between 0 and 1, not a percentage, but was ${value} — plan 7.3's "30-50%" is 0.3-0.5 here`,
    );
  }
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a whole number greater than zero, but was ${value}`);
  }
}

/**
 * One Bernoulli draw against a configured rate. Strictly below, so a rate
 * of 0 never fires and a rate of 1 always does.
 *
 * The generator is injected rather than reaching for Math.random, so both
 * the gold-injection rate and the sampling draw are reproducible in a test.
 */
function drawsBelowRate(rateName: string, rate: number, random: () => number): boolean {
  assertRate(rateName, rate);

  const draw = random();
  if (!Number.isFinite(draw) || draw < 0 || draw >= 1) {
    throw new Error(
      `${rateName}: the random generator must return a draw in [0, 1), but returned ${draw}`,
    );
  }

  return draw < rate;
}

/**
 * Whether this request should be served a seeded gold item (7.11), rather
 * than an ordinary one from the queue.
 */
export function shouldServeGoldItem(rate: number, random: () => number): boolean {
  return drawsBelowRate('goldItemRate', rate, random);
}

/**
 * Whether the sampling draw selects this item for human review (7.3).
 *
 * Called by the generation pipeline when it writes items.sampled_for_review;
 * nothing in the review queue calls it, because by then the draw has already
 * happened and is recorded on the row.
 */
export function shouldSampleForReview(rate: number, random: () => number): boolean {
  return drawsBelowRate('lowRiskSampleRate', rate, random);
}

export function validateReviewQueueConfig(config: ReviewQueueConfig): void {
  assertRate('goldItemRate', config.goldItemRate);
  assertRate('lowRiskSampleRate', config.lowRiskSampleRate);
  // A zero-minute claim expires the instant it is taken, handing the same
  // item to the next reviewer while the first is still reading it.
  assertPositiveInteger('claimDurationMinutes', config.claimDurationMinutes);
  assertPositiveInteger('batchMaxSize', config.batchMaxSize);
}
