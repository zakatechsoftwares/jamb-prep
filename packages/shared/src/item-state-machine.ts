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
 * The only table of legal source states. Every event names the states it may
 * be applied from; anything else throws. `rejected` and `retired` appear in
 * no list, which is what makes them terminal — not a special case in the
 * code, but the absence of any way out.
 */
const LEGAL_SOURCE_STATES: Record<LifecycleEvent['type'], readonly ItemStatus[]> = {
  gates_failed: ['generated'],
  gates_passed: ['generated'],
  auto_gate_promote: ['generated'],
  regenerated: ['gate_failed'],
  routed_for_judgement: ['gate_failed'],
  claimed: ['pending_review', 'needs_second_review'],
  claim_expired: ['in_review'],
  reviewer_decided: ['in_review'],
  moderator_ruled: ['escalated'],
  calibrated: ['approved_uncalibrated'],
  quarantined: ['approved_uncalibrated', 'approved_calibrated'],
  reworked: ['quarantined'],
  retired: ['approved_uncalibrated', 'approved_calibrated', 'quarantined'],
};

function isApproval(action: ReviewAction): boolean {
  return action === 'approve' || action === 'edit_and_approve';
}

function assertLegalSourceState(currentState: ItemStatus, event: LifecycleEvent): void {
  if (!LEGAL_SOURCE_STATES[event.type].includes(currentState)) {
    throw new Error(`transition: ${event.type} is not a legal transition from ${currentState}`);
  }
}

function assertValidTimestamp(occurredAt: Date): void {
  if (!(occurredAt instanceof Date) || Number.isNaN(occurredAt.getTime())) {
    throw new Error(
      'transition: occurredAt must be a valid Date — every transition is recorded with an actor and a timestamp',
    );
  }
}

/**
 * A human decision must be attributable to a person. The system may run the
 * gates and quarantine an item; it may never review one.
 */
function assertHumanActor(actor: LifecycleActor, eventType: LifecycleEvent['type']): number {
  if (actor.role === 'system') {
    throw new Error(`transition: ${eventType} requires a human actor, not the system`);
  }
  if (actor.userId === null) {
    throw new Error(
      `transition: ${eventType} requires an actor with a user id — every human decision is attributable`,
    );
  }
  return actor.userId;
}

/**
 * Plan 7.10: no reviewer approves their own contributed item. Applied to
 * every human decision, not only approvals — rejecting your own item is the
 * same conflict of interest — and to moderators, who are drawn from the same
 * pool (7.8, 7.13).
 */
function assertNotOwnContribution(actorUserId: number, item: ItemFacts): void {
  if (item.contributorUserId !== null && item.contributorUserId === actorUserId) {
    throw new Error(
      'transition: a reviewer may not decide on an item they authored — contributors and reviewers are one pool, but never on the same item',
    );
  }
}

/** Plan 7.10: the second opinion comes from a second *independent* reviewer. */
function assertHasNotAlreadyDecided(actorUserId: number, priorDecisions: PriorDecision[]): void {
  if (priorDecisions.some((decision) => decision.reviewerUserId === actorUserId)) {
    throw new Error(
      'transition: this reviewer has already decided on the item — a second review must come from a second independent reviewer',
    );
  }
}

function hasApproval(decisions: PriorDecision[]): boolean {
  return decisions.some((decision) => isApproval(decision.action));
}

function hasRejection(decisions: PriorDecision[]): boolean {
  return decisions.some((decision) => decision.action === 'reject');
}

/**
 * Section 7.14, stated exactly once. The automated pipeline may promote an
 * item without human review only when all three conditions hold; anything
 * else throws rather than quietly falling back to the review queue, because
 * a caller reaching for this door is asserting the item qualifies.
 */
function assertAutomatedRouteEligible(item: ItemFacts): void {
  if (item.riskTier !== 'low') {
    throw new Error(
      `transition: the automated route requires risk tier 'low', but this item is '${item.riskTier}' — every high risk_tier item requires a human decision (7.14)`,
    );
  }
  if (item.sampledForReview) {
    throw new Error(
      'transition: the automated route is not open to an item selected by the sampling draw — it requires a human decision (7.14)',
    );
  }
  if (item.independentSolveVerdict !== 'agreed') {
    throw new Error(
      `transition: the automated route requires an independent solve verdict of 'agreed', but this item is '${item.independentSolveVerdict}' (7.14)`,
    );
  }
}

function resolveReviewerDecision(
  action: ReviewAction,
  context: TransitionContext,
): { status: ItemStatus; approvalRoute: ApprovalRoute | null } {
  const { item, priorDecisions } = context;

  // Decisions that already disagree belong to a moderator, not to a third
  // reviewer. Opinions do not accumulate until one side wins.
  if (hasApproval(priorDecisions) && hasRejection(priorDecisions)) {
    throw new Error(
      'transition: the recorded decisions on this item already conflict — it must be resolved by a moderator, not by a further review decision',
    );
  }

  if (action === 'escalate') {
    return { status: 'escalated', approvalRoute: null };
  }

  if (isApproval(action)) {
    // Two conflicting decisions route to escalated, never to approved.
    if (hasRejection(priorDecisions)) {
      return { status: 'escalated', approvalRoute: null };
    }

    // A high risk_tier item, or one the blind solve disagreed with, cannot
    // reach the bank on one person's say-so. The second reviewer's own
    // decision is what releases it.
    const isFirstDecision = priorDecisions.length === 0;
    const requiresSecondOpinion =
      item.riskTier !== 'low' || item.independentSolveVerdict === 'disagreed';

    if (isFirstDecision && requiresSecondOpinion) {
      return { status: 'needs_second_review', approvalRoute: null };
    }

    return { status: 'approved_uncalibrated', approvalRoute: 'human_reviewed' };
  }

  if (hasApproval(priorDecisions)) {
    return { status: 'escalated', approvalRoute: null };
  }

  return { status: 'rejected', approvalRoute: null };
}

/**
 * Advances one item through the lifecycle in plan section 7.10, returning
 * the resulting state together with the approval route the transition
 * establishes and the actor and moment it must be recorded against.
 *
 * Pure and dependency-free: no DB access, no I/O, no clock. Throws on any
 * transition that is not legal from the current state, and on any transition
 * whose context violates a review rule — an unauthorised actor, a reviewer
 * deciding on their own item or deciding twice, an automated promotion of an
 * item that does not qualify. It never returns a falsy result or silently
 * routes around a violation: an item reaching candidates by an illegitimate
 * path is the failure this module exists to make impossible.
 */
export function transition(
  currentState: ItemStatus,
  event: LifecycleEvent,
  context: TransitionContext,
): TransitionResult {
  assertValidTimestamp(context.occurredAt);
  assertLegalSourceState(currentState, event);

  const audit = { actorUserId: context.actor.userId, occurredAt: context.occurredAt };

  switch (event.type) {
    case 'gates_failed':
      return { status: 'gate_failed', approvalRoute: null, ...audit };

    // Passing the gates only ever queues the item. Skipping human review is
    // a deliberate act, taken through auto_gate_promote below, so there is
    // no path to the live bank a caller can take by accident.
    case 'gates_passed':
      return { status: 'pending_review', approvalRoute: null, ...audit };

    case 'auto_gate_promote':
      assertAutomatedRouteEligible(context.item);
      return { status: 'approved_uncalibrated', approvalRoute: 'auto_gated', ...audit };

    case 'regenerated':
      return { status: 'generated', approvalRoute: null, ...audit };

    case 'routed_for_judgement':
      return { status: 'pending_review', approvalRoute: null, ...audit };

    case 'claimed': {
      const actorUserId = assertHumanActor(context.actor, event.type);
      assertNotOwnContribution(actorUserId, context.item);
      assertHasNotAlreadyDecided(actorUserId, context.priorDecisions);
      return { status: 'in_review', approvalRoute: null, ...audit };
    }

    // A lapsed claim returns the item to the queue it came from. Dropping a
    // second review back into pending_review would let a single reviewer
    // approve it, silently discarding the requirement that put it there.
    case 'claim_expired':
      return {
        status: context.priorDecisions.length > 0 ? 'needs_second_review' : 'pending_review',
        approvalRoute: null,
        ...audit,
      };

    case 'reviewer_decided': {
      const actorUserId = assertHumanActor(context.actor, event.type);
      assertNotOwnContribution(actorUserId, context.item);
      assertHasNotAlreadyDecided(actorUserId, context.priorDecisions);
      return { ...resolveReviewerDecision(event.action, context), ...audit };
    }

    case 'moderator_ruled': {
      const actorUserId = assertHumanActor(context.actor, event.type);
      if (context.actor.role !== 'moderator') {
        throw new Error(
          `transition: only a moderator may resolve an escalated item, but the actor is a ${context.actor.role}`,
        );
      }
      assertNotOwnContribution(actorUserId, context.item);

      return event.action === 'approve'
        ? { status: 'approved_uncalibrated', approvalRoute: 'moderator_ruled', ...audit }
        : { status: 'rejected', approvalRoute: null, ...audit };
    }

    case 'calibrated':
      return { status: 'approved_calibrated', approvalRoute: null, ...audit };

    // Applies to an auto_gated item exactly as to any other (7.14): reaching
    // the bank without a human review is not exemption from being pulled.
    case 'quarantined':
      return { status: 'quarantined', approvalRoute: null, ...audit };

    // Back to the queue, never straight back to live.
    case 'reworked':
      return { status: 'pending_review', approvalRoute: null, ...audit };

    case 'retired':
      return { status: 'retired', approvalRoute: null, ...audit };
  }
}
