import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  agreesWithKey,
  buildItemEditDiff,
  canReveal,
  transition,
  type ApprovalRoute,
  type DecideInput,
  type DecideOutcome,
  type DecisionContext,
  type IndependentSolveVerdict,
  type ItemEditDiff,
  type ItemSnapshot,
  type ItemStatus,
  type OptionLabel,
  type ResolveEscalationInput,
  type ResolveEscalationOutcome,
  type RevealOutcome,
  type RiskTier,
  type SolveOutcome,
} from '@jamb/shared';
import { firstRow } from './first-row';
import {
  loadPriorDecisions,
  loadReviewer,
  recordTransition,
  withTransaction,
} from './review-queue-repository';

/**
 * Records the reviewer's own answer, before the proposed key is ever
 * revealed (7.10). Atomic and race-safe: a single `UPDATE ... WHERE
 * reviewer_answer IS NULL` either records the answer or touches nothing,
 * so two near-simultaneous submissions can never both "win".
 *
 * Requires the caller to currently hold a live claim on the item — the
 * same ownership rule `reveal` and `decide` apply, since none of these
 * three calls make sense for an item somebody else is working.
 */
export async function submitBlindAnswer(
  reviewerId: number,
  itemId: number,
  answer: OptionLabel,
): Promise<SolveOutcome> {
  return withTransaction(async (client) => {
    const reviewer = await loadReviewer(client, reviewerId);

    const updated = await client.query(
      `UPDATE review_claims
          SET reviewer_answer = $3
        WHERE item_id = $1
          AND reviewer_id = $2
          AND expires_at > now()
          AND reviewer_answer IS NULL
        RETURNING item_id`,
      [itemId, reviewer.reviewer_id, answer],
    );

    if ((updated.rowCount ?? 0) > 0) {
      return { ok: true, itemId, answer };
    }

    // The UPDATE touched nothing. Distinguish why, so the caller gets an
    // accurate reason instead of a single generic failure: "you never
    // held this item" and "you already answered it" call for different
    // client behaviour (re-fetch the queue vs. proceed to reveal).
    const existing = await client.query(
      `SELECT 1 FROM review_claims
        WHERE item_id = $1 AND reviewer_id = $2 AND expires_at > now()`,
      [itemId, reviewer.reviewer_id],
    );

    return existing.rowCount === 0
      ? { ok: false, reason: 'not_claimed_by_you' }
      : { ok: false, reason: 'already_answered' };
  });
}

/**
 * Returns the proposed key, the explanation and the machine's verdict —
 * withheld at the API layer, not merely at the client, per plan 7.10. A
 * high risk_tier item returns `not_yet_solved` until `submitBlindAnswer`
 * has recorded an answer for this reviewer's current claim; every other
 * tier reveals immediately.
 */
export async function revealItem(reviewerId: number, itemId: number): Promise<RevealOutcome> {
  return withTransaction(async (client) => {
    const reviewer = await loadReviewer(client, reviewerId);

    const claim = await client.query<{ reviewer_answer: OptionLabel | null }>(
      `SELECT reviewer_answer FROM review_claims
        WHERE item_id = $1 AND reviewer_id = $2 AND expires_at > now()`,
      [itemId, reviewer.reviewer_id],
    );

    if (claim.rowCount === 0) {
      return { ok: false, reason: 'not_claimed_by_you' };
    }
    const reviewerAnswer = firstRow(claim).reviewer_answer;

    const item = firstRow(
      await client.query<{
        risk_tier: RiskTier;
        independent_solve_verdict: IndependentSolveVerdict;
        explanation: string;
      }>(`SELECT risk_tier, independent_solve_verdict, explanation FROM items WHERE id = $1`, [
        itemId,
      ]),
    );

    if (!canReveal(item.risk_tier, reviewerAnswer !== null)) {
      return { ok: false, reason: 'not_yet_solved' };
    }

    const correctOption = firstRow(
      await client.query<{ label: OptionLabel }>(
        `SELECT label FROM item_options WHERE item_id = $1 AND is_correct`,
        [itemId],
      ),
    ).label;

    return {
      ok: true,
      correctOption,
      explanation: item.explanation,
      verdict: item.independent_solve_verdict,
      agreesWithKey: agreesWithKey(reviewerAnswer, correctOption),
    };
  });
}

const OPTION_LABEL_ORDER: readonly OptionLabel[] = ['A', 'B', 'C', 'D'];

/**
 * Whether `userId` (a reviewer's `users.id`, not `reviewers.id`) ever held a
 * claim on this item — the audit trail records every 'claimed' transition
 * permanently, unlike `review_claims`, which is keyed on `item_id` alone and
 * gets overwritten the moment the item is reassigned. This is what lets
 * `decideOnItem` tell a genuine late-arriving decision (offline workspace,
 * 8.3: this reviewer really did have the item, just too late) apart from a
 * forged one (this reviewer never touched it at all).
 */
async function everClaimedByReviewer(
  client: PoolClient,
  itemId: number,
  userId: number,
): Promise<boolean> {
  const result = await client.query(
    `SELECT 1 FROM item_state_transitions
      WHERE item_id = $1 AND event = 'claimed' AND actor_user_id = $2
      LIMIT 1`,
    [itemId, userId],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * A retry of an already-recorded decision (8.3's idempotency discipline —
 * the offline workspace may upload the same queued decision more than
 * once). Returns the outcome exactly as it was the first time, reading the
 * item's current row rather than anything cached from the original
 * request, since a live decision's status could only be this row's status
 * anyway and a late-arrival's never depended on it.
 */
async function outcomeForIdempotencyKey(
  client: PoolClient,
  idempotencyKey: string,
): Promise<DecideOutcome> {
  const existing = firstRow(
    await client.query<{ item_id: number; decision_context: DecisionContext }>(
      `SELECT item_id, decision_context FROM review_decisions WHERE idempotency_key = $1`,
      [idempotencyKey],
    ),
  );
  const item = firstRow(
    await client.query<{ status: ItemStatus; approval_route: ApprovalRoute | null }>(
      `SELECT status, approval_route FROM items WHERE id = $1`,
      [existing.item_id],
    ),
  );
  return {
    ok: true,
    itemId: existing.item_id,
    status: item.status,
    approvalRoute: item.approval_route,
    decisionContext: existing.decision_context,
  };
}

/**
 * Records one of the four review actions (7.9) and drives the resulting
 * state transition, in the same transaction as any `edit_and_approve`
 * patch. Ordinarily requires the caller to currently hold a live claim on
 * the item — a decision is not a thing to make on an item you were never
 * assigned.
 *
 * The one exception is the offline workspace's late-arrival case (8.3): a
 * decision queued while offline can reach the server after its claim
 * expired and was reassigned. Rather than reject it outright, a reviewer
 * who can prove (via `everClaimedByReviewer`) they genuinely held the item
 * gets it recorded as an audit-only `decision_context: 'late_arrival'` row
 * — no state transition, no `items` write, no touching whichever claim or
 * decision belongs to the item's current holder. `transition()`'s guards
 * (self-review, deciding twice) are therefore not evaluated for a
 * late-arrival, since nothing is transitioning; a late-arrival is always
 * accepted once ownership is proven, which is a known, deliberately narrow
 * simplification, not an oversight.
 *
 * `transition()`'s guards on the live path (self-review, deciding twice, an
 * item that isn't actually awaiting this kind of decision) are reported as
 * `invalid_transition` rather than allowed to throw past this function:
 * they are conflicts with the item's current state, not caller bugs, and
 * the router turns this into 409 rather than 500.
 */
export async function decideOnItem(
  reviewerId: number,
  itemId: number,
  input: DecideInput,
): Promise<DecideOutcome> {
  return withTransaction(async (client) => {
    const reviewer = await loadReviewer(client, reviewerId);

    const claim = await client.query<{ reviewer_answer: OptionLabel | null; claimed_at: Date }>(
      `SELECT reviewer_answer, claimed_at FROM review_claims
        WHERE item_id = $1 AND reviewer_id = $2 AND expires_at > now()
          FOR UPDATE`,
      [itemId, reviewer.reviewer_id],
    );

    let reviewerAnswer: OptionLabel | null = null;
    let claimedAt: Date | null = null;
    let isLateArrival = false;

    if (claim.rowCount === 0) {
      if (!(await everClaimedByReviewer(client, itemId, reviewer.user_id))) {
        return { ok: false, reason: 'not_claimed_by_you' };
      }
      isLateArrival = true;
    } else {
      ({ reviewer_answer: reviewerAnswer, claimed_at: claimedAt } = firstRow(claim));
    }

    const item = firstRow(
      await client.query<{
        status: ItemStatus;
        contributor_id: number | null;
        risk_tier: RiskTier;
        independent_solve_verdict: IndependentSolveVerdict;
        sampled_for_review: boolean;
        stem: string;
        explanation: string;
        objective_id: number;
      }>(
        `SELECT status, contributor_id, risk_tier, independent_solve_verdict, sampled_for_review,
                stem, explanation, objective_id
           FROM items WHERE id = $1 FOR UPDATE`,
        [itemId],
      ),
    );

    const occurredAt = new Date();
    let transitionResult: ReturnType<typeof transition> | null = null;

    if (!isLateArrival) {
      const priorDecisions = (await loadPriorDecisions(client, [itemId])).get(itemId) ?? [];
      try {
        transitionResult = transition(
          item.status,
          { type: 'reviewer_decided', action: input.action },
          {
            item: {
              contributorUserId: item.contributor_id,
              riskTier: item.risk_tier,
              independentSolveVerdict: item.independent_solve_verdict,
              sampledForReview: item.sampled_for_review,
            },
            actor: { userId: reviewer.user_id, role: reviewer.role },
            occurredAt,
            priorDecisions,
          },
        );
      } catch (error) {
        return {
          ok: false,
          reason: 'invalid_transition',
          message: error instanceof Error ? error.message : String(error),
        };
      }
    }

    let editDiff: ItemEditDiff | null = null;
    if (input.action === 'edit_and_approve') {
      // parseDecisionInput guarantees edits is non-null exactly when the
      // action is edit_and_approve. For a late arrival the diff is recorded
      // for audit purposes only and never applied — the item's live content
      // belongs to whichever decision was actually authoritative.
      editDiff = buildItemEditDiff(await loadItemSnapshot(client, itemId, item), input.edits!);
      if (!isLateArrival) {
        await applyItemEdit(client, itemId, editDiff);
      }
    }

    // A late arrival has no live claim to time against — the reviewer's own
    // device knows how long they actually took, but the server's only
    // record of a start time (the claim) is gone by the time this lands.
    const secondsTaken =
      isLateArrival || claimedAt === null
        ? 0
        : Math.max(0, Math.round((occurredAt.getTime() - claimedAt.getTime()) / 1000));

    const idempotencyKey = input.idempotencyKey ?? randomUUID();

    const inserted = await client.query<{ id: number }>(
      `INSERT INTO review_decisions (
         item_id, reviewer_id, action, rejection_reason, reviewer_answer,
         seconds_taken, idempotency_key, edit_diff, decision_context
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [
        itemId,
        reviewer.reviewer_id,
        input.action,
        input.rejectionReason,
        reviewerAnswer,
        secondsTaken,
        idempotencyKey,
        editDiff ? JSON.stringify(editDiff) : null,
        isLateArrival ? 'late_arrival' : 'live',
      ],
    );

    if (inserted.rowCount === 0) {
      // ON CONFLICT (idempotency_key) fired: this exact decision was
      // already recorded by an earlier attempt (8.3's idempotent retry).
      // Nothing here has been applied twice — the transaction still commits
      // (there is nothing left to commit), and the caller gets back the
      // same outcome as the original request.
      return await outcomeForIdempotencyKey(client, idempotencyKey);
    }

    if (isLateArrival) {
      const current = firstRow(
        await client.query<{ status: ItemStatus; approval_route: ApprovalRoute | null }>(
          `SELECT status, approval_route FROM items WHERE id = $1`,
          [itemId],
        ),
      );
      return {
        ok: true,
        itemId,
        status: current.status,
        approvalRoute: current.approval_route,
        decisionContext: 'late_arrival',
      };
    }

    // transitionResult is non-null here: it is only ever left null on the
    // late-arrival branch, which returned above.
    const result = transitionResult!;

    // A null approvalRoute means "this transition establishes none; leave
    // the item's existing one alone" (see TransitionResult in
    // item-state-machine.ts) — COALESCE is what implements that reading in
    // SQL rather than overwriting a real route with NULL.
    await client.query(
      `UPDATE items SET status = $2, approval_route = COALESCE($3, approval_route) WHERE id = $1`,
      [itemId, result.status, result.approvalRoute],
    );

    // The item leaves in_review regardless of where it lands next, so the
    // claim that put it there is done, whatever the outcome.
    await client.query('DELETE FROM review_claims WHERE item_id = $1', [itemId]);

    await recordTransition(
      client,
      itemId,
      item.status,
      result.status,
      'reviewer_decided',
      result.actorUserId,
      reviewer.role,
      result.occurredAt,
      result.approvalRoute,
    );

    return {
      ok: true,
      itemId,
      status: result.status,
      approvalRoute: result.approvalRoute,
      decisionContext: 'live',
    };
  });
}

/**
 * A moderator's ruling on an item in `escalated` (session 04's guard 5).
 * Deliberately separate from `decideOnItem` rather than a mode of it: there
 * is no claim to check (a moderator does not claim the queue's way in), no
 * blind answer, no idempotency key, no `edit_and_approve`. `transition()`'s
 * own guards — only a moderator, never on your own contribution — are the
 * authority here exactly as they are for `decideOnItem`; `requireModerator`
 * in `apps/api` is a cheap up-front gate, not a substitute for them, which
 * is why a non-moderator caller reaching this function directly is still
 * refused.
 */
export async function resolveEscalation(
  reviewerId: number,
  itemId: number,
  input: ResolveEscalationInput,
): Promise<ResolveEscalationOutcome> {
  return withTransaction(async (client) => {
    const reviewer = await loadReviewer(client, reviewerId);

    const item = firstRow(
      await client.query<{
        status: ItemStatus;
        contributor_id: number | null;
        risk_tier: RiskTier;
        independent_solve_verdict: IndependentSolveVerdict;
        sampled_for_review: boolean;
      }>(
        `SELECT status, contributor_id, risk_tier, independent_solve_verdict, sampled_for_review
           FROM items WHERE id = $1 FOR UPDATE`,
        [itemId],
      ),
    );

    const occurredAt = new Date();

    let transitionResult;
    try {
      transitionResult = transition(
        item.status,
        { type: 'moderator_ruled', action: input.action },
        {
          item: {
            contributorUserId: item.contributor_id,
            riskTier: item.risk_tier,
            independentSolveVerdict: item.independent_solve_verdict,
            sampledForReview: item.sampled_for_review,
          },
          actor: { userId: reviewer.user_id, role: reviewer.role },
          occurredAt,
          priorDecisions: [],
        },
      );
    } catch (error) {
      return {
        ok: false,
        reason: 'invalid_transition',
        message: error instanceof Error ? error.message : String(error),
      };
    }

    await client.query(
      `UPDATE items SET status = $2, approval_route = COALESCE($3, approval_route) WHERE id = $1`,
      [itemId, transitionResult.status, transitionResult.approvalRoute],
    );

    await recordTransition(
      client,
      itemId,
      item.status,
      transitionResult.status,
      'moderator_ruled',
      transitionResult.actorUserId,
      reviewer.role,
      transitionResult.occurredAt,
      transitionResult.approvalRoute,
    );

    return {
      ok: true,
      itemId,
      status: transitionResult.status,
      approvalRoute: transitionResult.approvalRoute,
      decisionContext: 'live',
    };
  });
}

async function loadItemSnapshot(
  client: PoolClient,
  itemId: number,
  item: { stem: string; explanation: string; objective_id: number },
): Promise<ItemSnapshot> {
  const rows = (
    await client.query<{ label: OptionLabel; option_text: string; is_correct: boolean }>(
      `SELECT label, option_text, is_correct FROM item_options WHERE item_id = $1`,
      [itemId],
    )
  ).rows;

  const options = {} as Record<OptionLabel, string>;
  let key: OptionLabel | undefined;
  for (const row of rows) {
    options[row.label] = row.option_text;
    if (row.is_correct) {
      key = row.label;
    }
  }
  if (!key) {
    throw new Error(`item ${itemId} has no option marked correct — cannot build an edit snapshot`);
  }

  return {
    stem: item.stem,
    explanation: item.explanation,
    objectiveId: item.objective_id,
    key,
    options,
  };
}

/** Applies an already-computed diff to `items` and `item_options`. */
async function applyItemEdit(
  client: PoolClient,
  itemId: number,
  diff: ItemEditDiff,
): Promise<void> {
  if (diff.stem || diff.explanation || diff.objectiveId) {
    await client.query(
      `UPDATE items
          SET stem = COALESCE($2, stem),
              explanation = COALESCE($3, explanation),
              objective_id = COALESCE($4, objective_id)
        WHERE id = $1`,
      [
        itemId,
        diff.stem?.after ?? null,
        diff.explanation?.after ?? null,
        diff.objectiveId?.after ?? null,
      ],
    );
  }

  if (diff.options) {
    for (const label of OPTION_LABEL_ORDER) {
      const change = diff.options[label];
      if (!change) continue;
      await client.query(
        `UPDATE item_options SET option_text = $3 WHERE item_id = $1 AND label = $2`,
        [itemId, label, change.after],
      );
    }
  }

  if (diff.key) {
    // Two statements, not one: the partial unique index in 0005 permits at
    // most one is_correct row per item at any moment a statement commits,
    // so the old key is cleared before the new one is set rather than
    // both being touched in a single UPDATE.
    await client.query(`UPDATE item_options SET is_correct = false WHERE item_id = $1`, [itemId]);
    await client.query(
      `UPDATE item_options SET is_correct = true WHERE item_id = $1 AND label = $2`,
      [itemId, diff.key.after],
    );
  }
}
