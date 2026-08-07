import { describe, expect, it } from 'vitest';
import { ITEM_STATUSES, type ItemStatus } from './item-lifecycle';
import {
  transition,
  type ItemFacts,
  type LifecycleActor,
  type LifecycleEvent,
  type PriorDecision,
  type TransitionContext,
} from './item-state-machine';

const AT = new Date('2026-03-01T09:00:00.000Z');

const SYSTEM: LifecycleActor = { userId: null, role: 'system' };
const CONTENT_LEAD: LifecycleActor = { userId: 1, role: 'content_lead' };
const REVIEWER_A: LifecycleActor = { userId: 11, role: 'reviewer' };
const REVIEWER_B: LifecycleActor = { userId: 12, role: 'reviewer' };
const MODERATOR: LifecycleActor = { userId: 21, role: 'moderator' };

/** An item eligible for the automated route in 7.14: low, unsampled, agreed. */
const AUTO_ELIGIBLE: ItemFacts = {
  contributorUserId: null,
  riskTier: 'low',
  independentSolveVerdict: 'agreed',
  sampledForReview: false,
};

interface ContextOverrides {
  item?: Partial<ItemFacts>;
  actor?: LifecycleActor;
  occurredAt?: Date;
  priorDecisions?: PriorDecision[];
}

function ctx(overrides: ContextOverrides = {}): TransitionContext {
  return {
    item: { ...AUTO_ELIGIBLE, ...overrides.item },
    actor: overrides.actor ?? SYSTEM,
    occurredAt: overrides.occurredAt ?? AT,
    priorDecisions: overrides.priorDecisions ?? [],
  };
}

function approvalBy(actor: LifecycleActor): PriorDecision {
  return { reviewerUserId: actor.userId ?? 0, action: 'approve' };
}

function rejectionBy(actor: LifecycleActor): PriorDecision {
  return { reviewerUserId: actor.userId ?? 0, action: 'reject' };
}

// ---------------------------------------------------------------------------
// generated: the automated gates and the 7.14 automated-only route
// ---------------------------------------------------------------------------

describe('generated', () => {
  it('routes a failed gate to gate_failed', () => {
    const result = transition('generated', { type: 'gates_failed' }, ctx());

    expect(result.status).toBe('gate_failed');
    expect(result.approvalRoute).toBeNull();
  });

  it('promotes straight to approved_uncalibrated when all three 7.14 conditions hold', () => {
    // The auto-gated route: low risk_tier, not selected by the sampling
    // draw, independent solve agreed. This is the one path that skips the
    // review states entirely, so it is the one most easily lost.
    const result = transition('generated', { type: 'gates_passed' }, ctx({ item: AUTO_ELIGIBLE }));

    expect(result.status).toBe('approved_uncalibrated');
    expect(result.approvalRoute).toBe('auto_gated');
  });

  it('queues for human review when the item was selected by the sampling draw', () => {
    const result = transition(
      'generated',
      { type: 'gates_passed' },
      ctx({ item: { sampledForReview: true } }),
    );

    expect(result.status).toBe('pending_review');
    expect(result.approvalRoute).toBeNull();
  });

  it('queues for human review when risk_tier is high, however clean the gates were', () => {
    const result = transition(
      'generated',
      { type: 'gates_passed' },
      ctx({ item: { riskTier: 'high' } }),
    );

    expect(result.status).toBe('pending_review');
  });

  it('queues for human review when the independent solve disagreed', () => {
    const result = transition(
      'generated',
      { type: 'gates_passed' },
      ctx({ item: { independentSolveVerdict: 'disagreed' } }),
    );

    expect(result.status).toBe('pending_review');
  });

  it('queues for human review when the independent solve never ran', () => {
    // 'not_run' is not 'agreed'. 7.14 requires agreement, not merely the
    // absence of disagreement.
    const result = transition(
      'generated',
      { type: 'gates_passed' },
      ctx({ item: { independentSolveVerdict: 'not_run' } }),
    );

    expect(result.status).toBe('pending_review');
  });

  it('queues a not_generated (human-authored) item for human review', () => {
    const result = transition(
      'generated',
      { type: 'gates_passed' },
      ctx({ item: { riskTier: 'not_generated' } }),
    );

    expect(result.status).toBe('pending_review');
  });

  it('accepts an explicit auto_gate_promote when the item qualifies', () => {
    const result = transition('generated', { type: 'auto_gate_promote' }, ctx());

    expect(result.status).toBe('approved_uncalibrated');
    expect(result.approvalRoute).toBe('auto_gated');
  });
});

// ---------------------------------------------------------------------------
// gate_failed
// ---------------------------------------------------------------------------

describe('gate_failed', () => {
  it('returns to generated when the pipeline regenerates the item', () => {
    expect(transition('gate_failed', { type: 'regenerated' }, ctx()).status).toBe('generated');
  });

  it('routes to pending_review when the failure needs human judgement', () => {
    const result = transition(
      'gate_failed',
      { type: 'routed_for_judgement' },
      ctx({ actor: CONTENT_LEAD }),
    );

    expect(result.status).toBe('pending_review');
  });
});

// ---------------------------------------------------------------------------
// Claiming and releasing
// ---------------------------------------------------------------------------

describe('claiming', () => {
  it('moves a queued item to in_review when a reviewer claims it', () => {
    expect(
      transition('pending_review', { type: 'claimed' }, ctx({ actor: REVIEWER_A })).status,
    ).toBe('in_review');
  });

  it('moves a second-review item to in_review when a different reviewer claims it', () => {
    const result = transition(
      'needs_second_review',
      { type: 'claimed' },
      ctx({ actor: REVIEWER_B, priorDecisions: [approvalBy(REVIEWER_A)] }),
    );

    expect(result.status).toBe('in_review');
  });

  it('throws when the reviewer who already decided tries to claim the second review', () => {
    // Plan 7.10: a *second independent* reviewer decides. The same person
    // reviewing twice is not a second opinion.
    expect(() =>
      transition(
        'needs_second_review',
        { type: 'claimed' },
        ctx({ actor: REVIEWER_A, priorDecisions: [approvalBy(REVIEWER_A)] }),
      ),
    ).toThrow(/already decided/i);
  });

  it('releases an untouched claim back to the ordinary queue', () => {
    expect(transition('in_review', { type: 'claim_expired' }, ctx()).status).toBe('pending_review');
  });

  it('releases a lapsed second review back to needs_second_review, not to the ordinary queue', () => {
    // If an expired claim dropped the item into pending_review, a single
    // reviewer could then approve it — silently losing the second-review
    // requirement that put it there.
    const result = transition(
      'in_review',
      { type: 'claim_expired' },
      ctx({ priorDecisions: [approvalBy(REVIEWER_A)] }),
    );

    expect(result.status).toBe('needs_second_review');
  });
});

// ---------------------------------------------------------------------------
// Reviewer decisions
// ---------------------------------------------------------------------------

describe('reviewer decisions', () => {
  it('approves a low-risk agreed item on a single decision', () => {
    const result = transition(
      'in_review',
      { type: 'reviewer_decided', action: 'approve' },
      ctx({ actor: REVIEWER_A }),
    );

    expect(result.status).toBe('approved_uncalibrated');
    expect(result.approvalRoute).toBe('human_reviewed');
  });

  it('treats edit_and_approve exactly as an approval', () => {
    const result = transition(
      'in_review',
      { type: 'reviewer_decided', action: 'edit_and_approve' },
      ctx({ actor: REVIEWER_A }),
    );

    expect(result.status).toBe('approved_uncalibrated');
    expect(result.approvalRoute).toBe('human_reviewed');
  });

  it('rejects an item outright, establishing no approval route', () => {
    const result = transition(
      'in_review',
      { type: 'reviewer_decided', action: 'reject' },
      ctx({ actor: REVIEWER_A }),
    );

    expect(result.status).toBe('rejected');
    expect(result.approvalRoute).toBeNull();
  });

  it('escalates when the reviewer is unsure', () => {
    const result = transition(
      'in_review',
      { type: 'reviewer_decided', action: 'escalate' },
      ctx({ actor: REVIEWER_A }),
    );

    expect(result.status).toBe('escalated');
  });

  it('approves on the second decision once two reviewers agree', () => {
    const result = transition(
      'in_review',
      { type: 'reviewer_decided', action: 'approve' },
      ctx({
        actor: REVIEWER_B,
        item: { riskTier: 'high' },
        priorDecisions: [approvalBy(REVIEWER_A)],
      }),
    );

    expect(result.status).toBe('approved_uncalibrated');
    expect(result.approvalRoute).toBe('human_reviewed');
  });

  it('rejects on the second decision once two reviewers agree it is unusable', () => {
    const result = transition(
      'in_review',
      { type: 'reviewer_decided', action: 'reject' },
      ctx({ actor: REVIEWER_B, priorDecisions: [rejectionBy(REVIEWER_A)] }),
    );

    expect(result.status).toBe('rejected');
  });

  it('approves a not_run item on human review, since the human solve is the control', () => {
    // 'not_run' blocks the automated route but not a human decision: the
    // reviewer re-solving the item is the check that matters (7.3).
    const result = transition(
      'in_review',
      { type: 'reviewer_decided', action: 'approve' },
      ctx({ actor: REVIEWER_A, item: { independentSolveVerdict: 'not_run' } }),
    );

    expect(result.status).toBe('approved_uncalibrated');
  });

  it('throws when the same reviewer decides twice on one item', () => {
    expect(() =>
      transition(
        'in_review',
        { type: 'reviewer_decided', action: 'approve' },
        ctx({ actor: REVIEWER_A, priorDecisions: [approvalBy(REVIEWER_A)] }),
      ),
    ).toThrow(/already decided/i);
  });

  it('throws when the system, rather than a person, tries to record a review decision', () => {
    expect(() =>
      transition(
        'in_review',
        { type: 'reviewer_decided', action: 'approve' },
        ctx({ actor: SYSTEM }),
      ),
    ).toThrow(/human/i);
  });

  it('throws when a human actor carries no user id, since every decision is attributable', () => {
    expect(() =>
      transition(
        'in_review',
        { type: 'reviewer_decided', action: 'approve' },
        ctx({ actor: { userId: null, role: 'reviewer' } }),
      ),
    ).toThrow(/user id/i);
  });
});

// ---------------------------------------------------------------------------
// Guard 1 — high risk_tier never reaches approved_uncalibrated on one decision
// ---------------------------------------------------------------------------

describe('guard: a high risk_tier item never reaches approved_uncalibrated on a single decision', () => {
  it('routes a first approval of a high-risk item to needs_second_review', () => {
    const result = transition(
      'in_review',
      { type: 'reviewer_decided', action: 'approve' },
      ctx({ actor: REVIEWER_A, item: { riskTier: 'high' } }),
    );

    expect(result.status).toBe('needs_second_review');
    expect(result.status).not.toBe('approved_uncalibrated');
    expect(result.approvalRoute).toBeNull();
  });

  it('routes a first edit_and_approve of a high-risk item to needs_second_review too', () => {
    const result = transition(
      'in_review',
      { type: 'reviewer_decided', action: 'edit_and_approve' },
      ctx({ actor: REVIEWER_A, item: { riskTier: 'high' } }),
    );

    expect(result.status).toBe('needs_second_review');
  });

  it('throws when the automated route is attempted on a high-risk item', () => {
    expect(() =>
      transition('generated', { type: 'auto_gate_promote' }, ctx({ item: { riskTier: 'high' } })),
    ).toThrow(/high/i);
  });

  it('throws when the automated route is attempted on a not_generated item', () => {
    expect(() =>
      transition(
        'generated',
        { type: 'auto_gate_promote' },
        ctx({ item: { riskTier: 'not_generated' } }),
      ),
    ).toThrow(/risk tier|not_generated/i);
  });

  it('throws when the automated route is attempted on a sampled item', () => {
    expect(() =>
      transition(
        'generated',
        { type: 'auto_gate_promote' },
        ctx({ item: { sampledForReview: true } }),
      ),
    ).toThrow(/sampl/i);
  });
});

// ---------------------------------------------------------------------------
// Guard 2 — a disagreed independent solve forces a second review
// ---------------------------------------------------------------------------

describe('guard: independent_solve_verdict disagreed forces needs_second_review regardless of tier', () => {
  it('routes a first approval of a disagreed low-risk item to needs_second_review', () => {
    const result = transition(
      'in_review',
      { type: 'reviewer_decided', action: 'approve' },
      ctx({ actor: REVIEWER_A, item: { riskTier: 'low', independentSolveVerdict: 'disagreed' } }),
    );

    expect(result.status).toBe('needs_second_review');
    expect(result.status).not.toBe('approved_uncalibrated');
  });

  it('still approves once a second reviewer has agreed', () => {
    const result = transition(
      'in_review',
      { type: 'reviewer_decided', action: 'approve' },
      ctx({
        actor: REVIEWER_B,
        item: { independentSolveVerdict: 'disagreed' },
        priorDecisions: [approvalBy(REVIEWER_A)],
      }),
    );

    expect(result.status).toBe('approved_uncalibrated');
  });

  it('throws when the automated route is attempted on a disagreed item', () => {
    expect(() =>
      transition(
        'generated',
        { type: 'auto_gate_promote' },
        ctx({ item: { independentSolveVerdict: 'disagreed' } }),
      ),
    ).toThrow(/disagreed|independent solve/i);
  });

  it('throws when the automated route is attempted before the independent solve ran', () => {
    expect(() =>
      transition(
        'generated',
        { type: 'auto_gate_promote' },
        ctx({ item: { independentSolveVerdict: 'not_run' } }),
      ),
    ).toThrow(/not_run|independent solve/i);
  });
});

// ---------------------------------------------------------------------------
// Guard 3 — nobody decides on an item they authored
// ---------------------------------------------------------------------------

describe('guard: a reviewer may not decide on an item they authored', () => {
  const ownItem = { contributorUserId: REVIEWER_A.userId };

  it('throws when the contributor claims their own item', () => {
    expect(() =>
      transition('pending_review', { type: 'claimed' }, ctx({ actor: REVIEWER_A, item: ownItem })),
    ).toThrow(/own|authored|contributor/i);
  });

  it('throws when the contributor approves their own item', () => {
    expect(() =>
      transition(
        'in_review',
        { type: 'reviewer_decided', action: 'approve' },
        ctx({ actor: REVIEWER_A, item: ownItem }),
      ),
    ).toThrow(/own|authored|contributor/i);
  });

  it('throws when the contributor rejects their own item, not only when they approve it', () => {
    expect(() =>
      transition(
        'in_review',
        { type: 'reviewer_decided', action: 'reject' },
        ctx({ actor: REVIEWER_A, item: ownItem }),
      ),
    ).toThrow(/own|authored|contributor/i);
  });

  it('throws when a moderator rules on an item they authored', () => {
    expect(() =>
      transition(
        'escalated',
        { type: 'moderator_ruled', action: 'approve' },
        ctx({ actor: MODERATOR, item: { contributorUserId: MODERATOR.userId } }),
      ),
    ).toThrow(/own|authored|contributor/i);
  });

  it('allows a different reviewer to decide on a contributed item', () => {
    const result = transition(
      'in_review',
      { type: 'reviewer_decided', action: 'approve' },
      ctx({ actor: REVIEWER_B, item: ownItem }),
    );

    expect(result.status).toBe('approved_uncalibrated');
  });
});

// ---------------------------------------------------------------------------
// Guard 4 — conflicting decisions route to escalated, never to approved
// ---------------------------------------------------------------------------

describe('guard: two conflicting decisions route to escalated, never to approved', () => {
  it('escalates when a second reviewer approves what the first rejected', () => {
    const result = transition(
      'in_review',
      { type: 'reviewer_decided', action: 'approve' },
      ctx({ actor: REVIEWER_B, priorDecisions: [rejectionBy(REVIEWER_A)] }),
    );

    expect(result.status).toBe('escalated');
    expect(result.status).not.toBe('approved_uncalibrated');
    expect(result.approvalRoute).toBeNull();
  });

  it('escalates when a second reviewer rejects what the first approved', () => {
    const result = transition(
      'in_review',
      { type: 'reviewer_decided', action: 'reject' },
      ctx({ actor: REVIEWER_B, priorDecisions: [approvalBy(REVIEWER_A)] }),
    );

    expect(result.status).toBe('escalated');
    expect(result.status).not.toBe('rejected');
  });

  it('escalates a conflicting edit_and_approve as well as a plain approve', () => {
    const result = transition(
      'in_review',
      { type: 'reviewer_decided', action: 'edit_and_approve' },
      ctx({ actor: REVIEWER_B, priorDecisions: [rejectionBy(REVIEWER_A)] }),
    );

    expect(result.status).toBe('escalated');
  });

  it('throws when a reviewer decides on an item whose recorded decisions already conflict', () => {
    // Already in conflict means the item belongs to a moderator, not to a
    // third reviewer — no accumulation of opinions until one side wins.
    expect(() =>
      transition(
        'in_review',
        { type: 'reviewer_decided', action: 'approve' },
        ctx({
          actor: MODERATOR,
          priorDecisions: [approvalBy(REVIEWER_A), rejectionBy(REVIEWER_B)],
        }),
      ),
    ).toThrow(/conflict/i);
  });
});

// ---------------------------------------------------------------------------
// Guard 5 — only a moderator resolves an escalation
// ---------------------------------------------------------------------------

describe('guard: only a moderator may resolve an escalated item', () => {
  it('approves on a moderator ruling, recording the moderator_ruled route', () => {
    const result = transition(
      'escalated',
      { type: 'moderator_ruled', action: 'approve' },
      ctx({ actor: MODERATOR, priorDecisions: [approvalBy(REVIEWER_A), rejectionBy(REVIEWER_B)] }),
    );

    expect(result.status).toBe('approved_uncalibrated');
    expect(result.approvalRoute).toBe('moderator_ruled');
  });

  it('rejects on a moderator ruling', () => {
    const result = transition(
      'escalated',
      { type: 'moderator_ruled', action: 'reject' },
      ctx({ actor: MODERATOR }),
    );

    expect(result.status).toBe('rejected');
    expect(result.approvalRoute).toBeNull();
  });

  it('throws when a reviewer attempts a moderator ruling', () => {
    expect(() =>
      transition(
        'escalated',
        { type: 'moderator_ruled', action: 'approve' },
        ctx({ actor: REVIEWER_A }),
      ),
    ).toThrow(/moderator/i);
  });

  it('throws when a content lead attempts a moderator ruling', () => {
    expect(() =>
      transition(
        'escalated',
        { type: 'moderator_ruled', action: 'approve' },
        ctx({ actor: CONTENT_LEAD }),
      ),
    ).toThrow(/moderator/i);
  });

  it('throws when an escalated item is resolved by an ordinary review decision', () => {
    expect(() =>
      transition(
        'escalated',
        { type: 'reviewer_decided', action: 'approve' },
        ctx({ actor: REVIEWER_A }),
      ),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// The live states
// ---------------------------------------------------------------------------

describe('the live states', () => {
  it('calibrates an approved item once it has enough response data', () => {
    const result = transition('approved_uncalibrated', { type: 'calibrated' }, ctx());

    expect(result.status).toBe('approved_calibrated');
    // Calibration says nothing about who approved it: the route stands.
    expect(result.approvalRoute).toBeNull();
  });

  it('quarantines an approved_uncalibrated item', () => {
    expect(transition('approved_uncalibrated', { type: 'quarantined' }, ctx()).status).toBe(
      'quarantined',
    );
  });

  it('quarantines an approved_calibrated item', () => {
    expect(transition('approved_calibrated', { type: 'quarantined' }, ctx()).status).toBe(
      'quarantined',
    );
  });

  it('quarantines an auto_gated item exactly as any other, per 7.14', () => {
    // Reaching the bank without a human review is not exemption from being
    // pulled — an auto_gated item's live performance is its only check.
    const result = transition('approved_uncalibrated', { type: 'quarantined' }, ctx());

    expect(result.status).toBe('quarantined');
  });

  it('returns a reworked item to the review queue rather than straight to live', () => {
    const result = transition('quarantined', { type: 'reworked' }, ctx({ actor: CONTENT_LEAD }));

    expect(result.status).toBe('pending_review');
    expect(result.status).not.toBe('approved_uncalibrated');
  });

  it('retires an item from each state it can be withdrawn from', () => {
    const withdrawable: ItemStatus[] = [
      'approved_uncalibrated',
      'approved_calibrated',
      'quarantined',
    ];

    for (const status of withdrawable) {
      expect(transition(status, { type: 'retired' }, ctx({ actor: CONTENT_LEAD })).status).toBe(
        'retired',
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Terminal states
// ---------------------------------------------------------------------------

describe('terminal states', () => {
  const everyEvent: LifecycleEvent[] = [
    { type: 'gates_failed' },
    { type: 'gates_passed' },
    { type: 'auto_gate_promote' },
    { type: 'regenerated' },
    { type: 'routed_for_judgement' },
    { type: 'claimed' },
    { type: 'claim_expired' },
    { type: 'reviewer_decided', action: 'approve' },
    { type: 'moderator_ruled', action: 'approve' },
    { type: 'calibrated' },
    { type: 'quarantined' },
    { type: 'reworked' },
    { type: 'retired' },
  ];

  for (const terminal of ['rejected', 'retired'] as const) {
    for (const event of everyEvent) {
      it(`throws for ${event.type} from ${terminal}`, () => {
        expect(() => transition(terminal, event, ctx({ actor: MODERATOR }))).toThrow();
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Audit trail — every transition carries an actor and a timestamp
// ---------------------------------------------------------------------------

describe('audit trail', () => {
  it('returns the deciding actor and the moment, so the audit row is a product of the transition', () => {
    const occurredAt = new Date('2026-04-02T14:30:00.000Z');
    const result = transition(
      'in_review',
      { type: 'reviewer_decided', action: 'approve' },
      ctx({ actor: REVIEWER_A, occurredAt }),
    );

    expect(result.actorUserId).toBe(REVIEWER_A.userId);
    expect(result.occurredAt).toEqual(occurredAt);
  });

  it('returns a null actor for a system transition, never a fabricated user id', () => {
    const result = transition('approved_uncalibrated', { type: 'quarantined' }, ctx());

    expect(result.actorUserId).toBeNull();
    expect(result.occurredAt).toEqual(AT);
  });

  it('throws on an invalid timestamp rather than writing an unusable audit row', () => {
    expect(() =>
      transition('generated', { type: 'gates_failed' }, ctx({ occurredAt: new Date('nonsense') })),
    ).toThrow(/timestamp|occurredAt|date/i);
  });
});

// ---------------------------------------------------------------------------
// Exhaustive sweep: every (state, event) pair outside the table throws
// ---------------------------------------------------------------------------

const LEGAL_PAIRS: ReadonlyArray<readonly [ItemStatus, LifecycleEvent['type']]> = [
  ['generated', 'gates_failed'],
  ['generated', 'gates_passed'],
  ['generated', 'auto_gate_promote'],
  ['gate_failed', 'regenerated'],
  ['gate_failed', 'routed_for_judgement'],
  ['pending_review', 'claimed'],
  ['in_review', 'claim_expired'],
  ['in_review', 'reviewer_decided'],
  ['needs_second_review', 'claimed'],
  ['escalated', 'moderator_ruled'],
  ['approved_uncalibrated', 'calibrated'],
  ['approved_uncalibrated', 'quarantined'],
  ['approved_uncalibrated', 'retired'],
  ['approved_calibrated', 'quarantined'],
  ['approved_calibrated', 'retired'],
  ['quarantined', 'reworked'],
  ['quarantined', 'retired'],
];

/**
 * One representative event per type, each with an actor for whom that event
 * would be permissible — so anything the sweep catches is rejected because
 * of the state, not because of an unrelated guard.
 */
const EVENT_SAMPLES: ReadonlyArray<{ event: LifecycleEvent; actor: LifecycleActor }> = [
  { event: { type: 'gates_failed' }, actor: SYSTEM },
  { event: { type: 'gates_passed' }, actor: SYSTEM },
  { event: { type: 'auto_gate_promote' }, actor: SYSTEM },
  { event: { type: 'regenerated' }, actor: SYSTEM },
  { event: { type: 'routed_for_judgement' }, actor: CONTENT_LEAD },
  { event: { type: 'claimed' }, actor: REVIEWER_A },
  { event: { type: 'claim_expired' }, actor: SYSTEM },
  { event: { type: 'reviewer_decided', action: 'approve' }, actor: REVIEWER_A },
  { event: { type: 'moderator_ruled', action: 'approve' }, actor: MODERATOR },
  { event: { type: 'calibrated' }, actor: SYSTEM },
  { event: { type: 'quarantined' }, actor: SYSTEM },
  { event: { type: 'reworked' }, actor: CONTENT_LEAD },
  { event: { type: 'retired' }, actor: CONTENT_LEAD },
];

describe('rejects every transition outside the table', () => {
  for (const status of ITEM_STATUSES) {
    for (const { event, actor } of EVENT_SAMPLES) {
      const isLegal = LEGAL_PAIRS.some(([s, e]) => s === status && e === event.type);
      if (isLegal) continue;

      it(`throws for ${event.type} from ${status}`, () => {
        expect(() => transition(status, event, ctx({ actor }))).toThrow();
      });
    }
  }

  it('covers every state and every event type', () => {
    // Guards the sweep itself: if a state or an event is added and this
    // table is not updated, the sweep silently stops being exhaustive.
    expect(ITEM_STATUSES).toHaveLength(11);
    expect(EVENT_SAMPLES).toHaveLength(13);
  });
});
