import type { IndependentSolveVerdict, ItemStatus, RiskTier } from './item-lifecycle';

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
  /** A rate in [0, 1], deliberately not a percentage — see the README. */
  lowRiskSampleRate: number;
  claimDurationMinutes: number;
  batchMaxSize: number;
}

/** NOT YET IMPLEMENTED — tests first, per CLAUDE.md. */
export function requiresHumanReview(_candidate: QueueCandidate): boolean {
  return false;
}

/** NOT YET IMPLEMENTED — tests first, per CLAUDE.md. */
export function priorityOf(_candidate: QueueCandidate): QueuePriority {
  return QUEUE_PRIORITIES.sampledLowRisk;
}

/** NOT YET IMPLEMENTED — tests first, per CLAUDE.md. */
export function isEligibleForReviewer(
  _candidate: QueueCandidate,
  _reviewer: QueueReviewer,
): boolean {
  return false;
}

/** NOT YET IMPLEMENTED — tests first, per CLAUDE.md. */
export function compareQueueEntries(_left: QueueCandidate, _right: QueueCandidate): number {
  return 0;
}

/** NOT YET IMPLEMENTED — tests first, per CLAUDE.md. */
export function shouldServeGoldItem(_rate: number, _random: () => number): boolean {
  return false;
}

/** NOT YET IMPLEMENTED — tests first, per CLAUDE.md. */
export function shouldSampleForReview(_rate: number, _random: () => number): boolean {
  return false;
}

/** NOT YET IMPLEMENTED — tests first, per CLAUDE.md. */
export function validateReviewQueueConfig(_config: ReviewQueueConfig): void {
  return;
}
