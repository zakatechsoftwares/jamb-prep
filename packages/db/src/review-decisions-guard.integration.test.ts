import { describe, expect, it } from 'vitest';

// Requires a live Postgres with migrations applied (DATABASE_URL). Skipped
// automatically where it isn't set, rather than failing the suite. See
// migrate.integration.test.ts for why client.ts/first-row.ts are imported
// dynamically inside the guarded test body.
const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.runIf(hasDatabase)('review workflow append-only guards', () => {
  it('rejects UPDATE and DELETE against review_decisions and item_state_transitions', async () => {
    const { pool } = await import('./client');
    const { firstRow } = await import('./first-row');
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const subjectId = firstRow(
        await client.query<{ id: number }>(
          `INSERT INTO subjects (name) VALUES ('__review_guard_subject__')
           ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
           RETURNING id`,
        ),
      ).id;

      const topicId = firstRow(
        await client.query<{ id: number }>(
          `INSERT INTO topics (subject_id, name) VALUES ($1, '__review_guard_topic__')
           ON CONFLICT (subject_id, name) DO UPDATE SET name = EXCLUDED.name
           RETURNING id`,
          [subjectId],
        ),
      ).id;

      const subtopicId = firstRow(
        await client.query<{ id: number }>(
          `INSERT INTO subtopics (topic_id, name) VALUES ($1, '__review_guard_subtopic__')
           ON CONFLICT (topic_id, name) DO UPDATE SET name = EXCLUDED.name
           RETURNING id`,
          [topicId],
        ),
      ).id;

      const objectiveId = firstRow(
        await client.query<{ id: number }>(
          `INSERT INTO objectives (subtopic_id, description) VALUES ($1, '__review_guard_objective__')
           ON CONFLICT (subtopic_id, description) DO UPDATE SET description = EXCLUDED.description
           RETURNING id`,
          [subtopicId],
        ),
      ).id;

      const itemId = firstRow(
        await client.query<{ id: number }>(
          `INSERT INTO items (
             subject_id, topic_id, subtopic_id, objective_id,
             stem, explanation, cognitive_level, expected_time_seconds, risk_tier
           ) VALUES ($1, $2, $3, $4, 'stem', 'explanation', 'recall', 30, 'high')
           RETURNING id`,
          [subjectId, topicId, subtopicId, objectiveId],
        ),
      ).id;

      const userId = firstRow(
        await client.query<{ id: number }>(
          `INSERT INTO users (full_name, phone, exam_year)
           VALUES ('Review Guard Test', '__review_guard_phone__', 2026)
           RETURNING id`,
        ),
      ).id;

      const reviewerId = firstRow(
        await client.query<{ id: number }>(
          `INSERT INTO reviewers (user_id, role, status) VALUES ($1, 'reviewer', 'active')
           RETURNING id`,
          [userId],
        ),
      ).id;

      const decisionId = firstRow(
        await client.query<{ id: number }>(
          `INSERT INTO review_decisions (
             item_id, reviewer_id, action, reviewer_answer, seconds_taken, idempotency_key
           ) VALUES ($1, $2, 'approve', 'B', 45, '__review_guard_decision__')
           RETURNING id`,
          [itemId, reviewerId],
        ),
      ).id;

      const transitionId = firstRow(
        await client.query<{ id: number }>(
          `INSERT INTO item_state_transitions (
             item_id, from_status, to_status, event, actor_user_id, actor_role,
             approval_route, occurred_at
           ) VALUES ($1, 'in_review', 'needs_second_review', 'reviewer_decided', $2, 'reviewer', NULL, now())
           RETURNING id`,
          [itemId, userId],
        ),
      ).id;

      // A reviewer who changes their mind records a new decision. They never
      // edit the old one — the decision log is the audit trail, and one that
      // can be rewritten is not an audit trail.
      await client.query('SAVEPOINT before_decision_update');
      await expect(
        client.query('UPDATE review_decisions SET seconds_taken = 99 WHERE id = $1', [decisionId]),
      ).rejects.toThrow(/append-only/);
      await client.query('ROLLBACK TO SAVEPOINT before_decision_update');

      await client.query('SAVEPOINT before_decision_delete');
      await expect(
        client.query('DELETE FROM review_decisions WHERE id = $1', [decisionId]),
      ).rejects.toThrow(/append-only/);
      await client.query('ROLLBACK TO SAVEPOINT before_decision_delete');

      await client.query('SAVEPOINT before_transition_update');
      await expect(
        client.query('UPDATE item_state_transitions SET to_status = $1 WHERE id = $2', [
          'approved_uncalibrated',
          transitionId,
        ]),
      ).rejects.toThrow(/append-only/);
      await client.query('ROLLBACK TO SAVEPOINT before_transition_update');

      await client.query('SAVEPOINT before_transition_delete');
      await expect(
        client.query('DELETE FROM item_state_transitions WHERE id = $1', [transitionId]),
      ).rejects.toThrow(/append-only/);
      await client.query('ROLLBACK TO SAVEPOINT before_transition_delete');

      // The same reviewer cannot decide twice on one item: plan 7.10's
      // second opinion is a second *independent* reviewer. Enforced in the
      // state machine and here, so a direct insert cannot bypass it.
      await client.query('SAVEPOINT before_duplicate_decision');
      await expect(
        client.query(
          `INSERT INTO review_decisions (
             item_id, reviewer_id, action, rejection_reason, seconds_taken, idempotency_key
           ) VALUES ($1, $2, 'reject', 'wrong_key', 30, '__review_guard_decision_2__')`,
          [itemId, reviewerId],
        ),
      ).rejects.toThrow(/review_decisions_one_per_reviewer_idx/);
      await client.query('ROLLBACK TO SAVEPOINT before_duplicate_decision');

      // A rejection must name a reason from the structured taxonomy (7.9),
      // and nothing else may carry one.
      await client.query('SAVEPOINT before_reasonless_rejection');
      await expect(
        client.query(
          `INSERT INTO review_decisions (item_id, reviewer_id, action, seconds_taken, idempotency_key)
           VALUES ($1, $2, 'reject', 30, '__review_guard_decision_3__')`,
          [itemId, reviewerId],
        ),
      ).rejects.toThrow(/rejection_reason_required/);
      await client.query('ROLLBACK TO SAVEPOINT before_reasonless_rejection');

      // Every human transition names the human. Only the automated pipeline
      // may leave the actor null.
      await client.query('SAVEPOINT before_anonymous_transition');
      await expect(
        client.query(
          `INSERT INTO item_state_transitions (item_id, from_status, to_status, event, actor_role, occurred_at)
           VALUES ($1, 'in_review', 'rejected', 'reviewer_decided', 'reviewer', now())`,
          [itemId],
        ),
      ).rejects.toThrow(/human_actor_identified/);
      await client.query('ROLLBACK TO SAVEPOINT before_anonymous_transition');
    } finally {
      // Discards every fixture row inserted above — this test never leaves
      // data behind, regardless of outcome.
      await client.query('ROLLBACK');
      client.release();
    }

    await pool.end();
  });
});
