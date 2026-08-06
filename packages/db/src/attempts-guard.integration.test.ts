import { describe, expect, it } from 'vitest';

// Requires a live Postgres with migrations applied (DATABASE_URL). Skipped
// automatically where it isn't set, rather than failing the suite. See
// migrate.integration.test.ts for why client.ts/first-row.ts are imported
// dynamically inside the guarded test body.
const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.runIf(hasDatabase)('attempts append-only guard', () => {
  it('rejects UPDATE and DELETE against attempts', async () => {
    const { pool } = await import('./client');
    const { firstRow } = await import('./first-row');
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const subjectId = firstRow(
        await client.query<{ id: number }>(
          `INSERT INTO subjects (name) VALUES ('__guard_test_subject__')
           ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
           RETURNING id`,
        ),
      ).id;

      const topicId = firstRow(
        await client.query<{ id: number }>(
          `INSERT INTO topics (subject_id, name) VALUES ($1, '__guard_test_topic__')
           ON CONFLICT (subject_id, name) DO UPDATE SET name = EXCLUDED.name
           RETURNING id`,
          [subjectId],
        ),
      ).id;

      const subtopicId = firstRow(
        await client.query<{ id: number }>(
          `INSERT INTO subtopics (topic_id, name) VALUES ($1, '__guard_test_subtopic__')
           ON CONFLICT (topic_id, name) DO UPDATE SET name = EXCLUDED.name
           RETURNING id`,
          [topicId],
        ),
      ).id;

      const objectiveId = firstRow(
        await client.query<{ id: number }>(
          `INSERT INTO objectives (subtopic_id, description) VALUES ($1, '__guard_test_objective__')
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
           ) VALUES ($1, $2, $3, $4, 'stem', 'explanation', 'recall', 30, 'low')
           RETURNING id`,
          [subjectId, topicId, subtopicId, objectiveId],
        ),
      ).id;

      const userId = firstRow(
        await client.query<{ id: number }>(
          `INSERT INTO users (full_name, phone, exam_year)
           VALUES ('Guard Test', '__guard_test_phone__', 2026)
           RETURNING id`,
        ),
      ).id;

      const examConfigId = firstRow(
        await client.query<{ id: number }>(
          `INSERT INTO exam_configs (exam_year, version, total_duration_minutes, total_marks)
           VALUES (9999, 1, 120, 400)
           RETURNING id`,
        ),
      ).id;

      const sessionId = firstRow(
        await client.query<{ id: number }>(
          `INSERT INTO sessions (user_id, exam_config_id, mode, device_id, client_session_id, started_at)
           VALUES ($1, $2, 'practice', '__guard_test_device__', '__guard_test_session__', now())
           RETURNING id`,
          [userId, examConfigId],
        ),
      ).id;

      const attemptId = firstRow(
        await client.query<{ id: number }>(
          `INSERT INTO attempts (session_id, item_id, user_id, chosen_option, is_correct, seconds_taken, answered_at, idempotency_key)
           VALUES ($1, $2, $3, 'A', true, 30, now(), '__guard_test_attempt__')
           RETURNING id`,
          [sessionId, itemId, userId],
        ),
      ).id;

      await client.query('SAVEPOINT before_update');
      await expect(
        client.query('UPDATE attempts SET flagged = true WHERE id = $1', [attemptId]),
      ).rejects.toThrow(/append-only/);
      await client.query('ROLLBACK TO SAVEPOINT before_update');

      await client.query('SAVEPOINT before_delete');
      await expect(client.query('DELETE FROM attempts WHERE id = $1', [attemptId])).rejects.toThrow(
        /append-only/,
      );
      await client.query('ROLLBACK TO SAVEPOINT before_delete');
    } finally {
      // Discards every fixture row inserted above — this test never leaves
      // data behind, regardless of outcome.
      await client.query('ROLLBACK');
      client.release();
    }

    await pool.end();
  });
});
