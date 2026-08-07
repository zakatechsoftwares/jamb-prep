/**
 * The item lifecycle vocabulary — the single home for these values in the
 * whole codebase.
 *
 * Every one of these lists is defined here and nowhere else. The database
 * CHECK constraints in `packages/db/migrations/0012_item_review_workflow`
 * hold the same values, and `packages/db/src/lifecycle-vocabulary.test.ts`
 * asserts the two never drift apart. No package may retype any of these
 * unions locally.
 *
 * Values come from `docs/implementation-plan.md` sections 7.3, 7.6, 7.9,
 * 7.10 and 7.14. The plan is the source of truth; this file is its
 * executable form.
 */

/** Plan 7.10: the eleven item states, in lifecycle order. */
export const ITEM_STATUSES = [
  'generated',
  'gate_failed',
  'pending_review',
  'in_review',
  'needs_second_review',
  'escalated',
  'approved_uncalibrated',
  'approved_calibrated',
  'quarantined',
  'rejected',
  'retired',
] as const;

export type ItemStatus = (typeof ITEM_STATUSES)[number];

/** Plan 7.10: `rejected` and `retired` are terminal. Nothing leaves them. */
export const TERMINAL_ITEM_STATUSES = [
  'rejected',
  'retired',
] as const satisfies readonly ItemStatus[];

/**
 * Plan 7.14: how an item reached its current approved status, so the share
 * of the live bank no human has ever seen is directly queryable.
 */
export const APPROVAL_ROUTES = ['auto_gated', 'human_reviewed', 'moderator_ruled'] as const;

export type ApprovalRoute = (typeof APPROVAL_ROUTES)[number];

/**
 * Plan 7.3. `not_generated` covers the third tier — diagram, reading-text
 * and current-affairs items, which are human-authored rather than
 * generated, and so can never take the automated route in 7.14.
 */
export const RISK_TIERS = ['low', 'high', 'not_generated'] as const;

export type RiskTier = (typeof RISK_TIERS)[number];

/**
 * Plan 7.4 step 3. `not_run` is an explicit recorded fact rather than a
 * NULL, because 7.14 turns on the verdict being exactly 'agreed': "the
 * check never ran" and "the check disagreed" must both be visibly
 * ineligible for the automated route, not absent.
 */
export const INDEPENDENT_SOLVE_VERDICTS = ['agreed', 'disagreed', 'not_run'] as const;

export type IndependentSolveVerdict = (typeof INDEPENDENT_SOLVE_VERDICTS)[number];

/** Plan 7.9: the four actions the reviewer workspace offers. Nothing else. */
export const REVIEW_ACTIONS = ['approve', 'edit_and_approve', 'reject', 'escalate'] as const;

export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

/**
 * Plan 7.9: the structured rejection taxonomy. Free text is deliberately
 * not an option — these aggregate into prompt corrections, and a free-text
 * note is unusable in aggregate.
 */
export const REJECTION_REASONS = [
  'wrong_key',
  'ambiguous_stem',
  'implausible_distractor',
  'off_syllabus',
  'duplicate',
  'style_breach',
  'requires_diagram',
  'factually_wrong',
] as const;

export type RejectionReason = (typeof REJECTION_REASONS)[number];

/** Plan 7.8 panel structure. One person may hold different roles over time. */
export const PANEL_ROLES = ['content_lead', 'moderator', 'reviewer', 'contributor'] as const;

export type PanelRole = (typeof PANEL_ROLES)[number];

/**
 * Plan 7.8 onboarding and 7.11 quality assurance: a reviewer applies,
 * works a calibration set, is activated, and may be suspended for
 * re-calibration or removed from the panel.
 */
export const REVIEWER_STATUSES = [
  'applied',
  'calibrating',
  'active',
  'suspended',
  'removed',
] as const;

export type ReviewerStatus = (typeof REVIEWER_STATUSES)[number];

/** Plan 3: four options, A–D, one correct. */
export const OPTION_LABELS = ['A', 'B', 'C', 'D'] as const;

export type OptionLabel = (typeof OPTION_LABELS)[number];

/**
 * Plan 7.11: a seeded gold item's reference decision — what a reviewer
 * performing correctly is expected to do with it.
 */
export const GOLD_REFERENCE_DECISIONS = ['approve', 'reject', 'escalate'] as const;

export type GoldReferenceDecision = (typeof GOLD_REFERENCE_DECISIONS)[number];
