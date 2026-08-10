import type { PoolClient } from 'pg';
import {
  computeInterRaterAgreement,
  type ReviewAction,
  type SubjectAgreement,
} from '@jamb/shared';

/**
 * Inter-rater agreement per subject (plan 7.11 / session 09 addition) — a
 * **content** signal, not a reviewer signal (see
 * `packages/shared/inter-rater-agreement.ts`'s own doc comment). Pairs the
 * two chronologically-earliest *live* decisions on each item — the state
 * machine's own guards mean a live-decided item can never accumulate more
 * than two (a third decision either escalates or is refused), so this
 * always pairs the actual first and second reviewer, never something else.
 * A `late_arrival` decision is excluded from pairing entirely: it never
 * resolved the second review (see `decideOnItem`), so it was never really
 * "the second reviewer" in the sense this metric measures.
 */
export async function interRaterAgreementBySubject(client: PoolClient): Promise<SubjectAgreement[]> {
  const result = await client.query<{
    subject_id: number;
    first_action: ReviewAction;
    second_action: ReviewAction;
  }>(
    `SELECT i.subject_id, first_d.action AS first_action, second_d.action AS second_action
       FROM review_decisions first_d
       JOIN review_decisions second_d
         ON second_d.item_id = first_d.item_id
        AND second_d.created_at > first_d.created_at
        AND second_d.decision_context = 'live'
       JOIN items i ON i.id = first_d.item_id
      WHERE first_d.decision_context = 'live'`,
  );

  return computeInterRaterAgreement(
    result.rows.map((row) => ({
      subjectId: row.subject_id,
      firstAction: row.first_action,
      secondAction: row.second_action,
    })),
  );
}
