import type {
  ApprovalRoute,
  ItemStatus,
  IndependentSolveVerdict,
  PanelRole,
  ReviewAction,
  RiskTier,
} from './item-lifecycle';

/**
 * The actor responsible for a transition. `system` covers the automated
 * pipeline (gates, calibration, automatic quarantine, claim expiry) and
 * carries no user id; every human decision must carry one.
 */
export type ActorRole = PanelRole | 'system';

export interface LifecycleActor {
  userId: number | null;
  role: ActorRole;
}

/**
 * The item's own facts, as far as the state machine is concerned. Read from
 * the `items` row; never inferred.
 */
export interface ItemFacts {
  /** `items.contributor_id` — who authored it, if a human did. */
  contributorUserId: number | null;
  riskTier: RiskTier;
  independentSolveVerdict: IndependentSolveVerdict;
  /** Whether the 7.3 sampling draw selected this item for human review. */
  sampledForReview: boolean;
}

/** One `review_decisions` row already recorded against this item. */
export interface PriorDecision {
  reviewerUserId: number;
  action: ReviewAction;
}

export interface TransitionContext {
  item: ItemFacts;
  actor: LifecycleActor;
  occurredAt: Date;
  /** Every prior decision on this item, oldest first. */
  priorDecisions: PriorDecision[];
}

export type LifecycleEvent =
  | { type: 'gates_failed' }
  | { type: 'gates_passed' }
  | { type: 'auto_gate_promote' }
  | { type: 'regenerated' }
  | { type: 'routed_for_judgement' }
  | { type: 'claimed' }
  | { type: 'claim_expired' }
  | { type: 'reviewer_decided'; action: ReviewAction }
  | { type: 'moderator_ruled'; action: 'approve' | 'reject' }
  | { type: 'calibrated' }
  | { type: 'quarantined' }
  | { type: 'reworked' }
  | { type: 'retired' };

export interface TransitionResult {
  status: ItemStatus;
  /**
   * The route this transition establishes, or null when the transition
   * does not establish one and the item's existing `approval_route` should
   * be left untouched.
   */
  approvalRoute: ApprovalRoute | null;
  /** Echoed back so the audit row is a direct product of the transition. */
  actorUserId: number | null;
  occurredAt: Date;
}

/**
 * NOT YET IMPLEMENTED — tests first, per CLAUDE.md. This stub exists so the
 * test file typechecks; it returns a fixed value so the suite is red for the
 * right reason rather than passing the `toThrow` assertions by accident.
 */
export function transition(
  _currentState: ItemStatus,
  _event: LifecycleEvent,
  _context: TransitionContext,
): TransitionResult {
  return {
    status: 'gate_failed',
    approvalRoute: null,
    actorUserId: null,
    occurredAt: new Date(0),
  };
}
