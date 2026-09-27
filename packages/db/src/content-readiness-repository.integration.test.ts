import { afterAll, beforeEach, describe, expect, it } from 'vitest';

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.runIf(hasDatabase)('content-readiness-repository', () => {
  async function withWorld<T>(
    run: (context: {
      client: import('pg').PoolClient;
      world: import('./exam-session.fixtures').ExamWorld;
      subjectCombinationReadiness: typeof import('./content-readiness-repository').subjectCombinationReadiness;
    }) => Promise<T>,
  ): Promise<T> {
    const { pool } = await import('./client');
    const { seedExamWorld } = await import('./exam-session.fixtures');
    const { subjectCombinationReadiness } = await import('./content-readiness-repository');
    const client = await pool.connect();

    try {
      const world = await seedExamWorld(client);
      return await run({ client, world, subjectCombinationReadiness });
    } finally {
      client.release();
    }
  }

  beforeEach(async () => {
    const { pool } = await import('./client');
    const { truncateQueueWorld } = await import('./review-queue.fixtures');
    const client = await pool.connect();
    try {
      await truncateQueueWorld(client);
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    const { pool } = await import('./client');
    const { truncateQueueWorld } = await import('./review-queue.fixtures');
    const client = await pool.connect();
    try {
      await truncateQueueWorld(client);
    } finally {
      client.release();
      await pool.end();
    }
  });

  it('is not ready by default — seedExamWorld gives one approved item per subject against a 60/40 requirement', async () => {
    await withWorld(async ({ client, world, subjectCombinationReadiness }) => {
      const results = await subjectCombinationReadiness(client);

      expect(results).toHaveLength(1);
      const combo = results[0]!;
      expect(combo.ready).toBe(false);

      const english = combo.subjects.find((s) => s.subjectId === world.englishSubjectId);
      expect(english).toMatchObject({ approvedCount: 1, requiredCount: 60, ready: false });

      for (const electiveId of world.electiveSubjectIds) {
        const elective = combo.subjects.find((s) => s.subjectId === electiveId);
        expect(elective).toMatchObject({ approvedCount: 1, requiredCount: 40, ready: false });
      }
    });
  });

  it('becomes ready once supply meets a lowered requirement', async () => {
    await withWorld(async ({ client, world, subjectCombinationReadiness }) => {
      await client.query(
        `UPDATE exam_config_subject_rules SET items_per_subject = 1 WHERE exam_config_id = $1`,
        [world.examConfigId],
      );

      const results = await subjectCombinationReadiness(client);

      expect(results).toHaveLength(1);
      expect(results[0]?.ready).toBe(true);
      expect(results[0]?.subjects.every((s) => s.ready)).toBe(true);
    });
  });

  it('returns an empty array, not a throw, when no exam config is active', async () => {
    await withWorld(async ({ client, subjectCombinationReadiness }) => {
      await client.query(`UPDATE exam_configs SET is_active = false`);

      await expect(subjectCombinationReadiness(client)).resolves.toEqual([]);
    });
  });

  it('computes multiple combinations independently', async () => {
    await withWorld(async ({ client, world, subjectCombinationReadiness }) => {
      // A second combination sharing English but with its own, entirely
      // unapproved elective subject -- must never inherit the first
      // combination's readiness. computeSubjectCombinationReadiness doesn't
      // require a combination to have exactly slot_count electives (that
      // enforcement is loadExamConfigForUser's job, a different consumer),
      // so a single new elective subject is enough to exercise this.
      const newSubjectId = (
        await client.query<{ id: number }>(`INSERT INTO subjects (name) VALUES ('Second Combo Elective') RETURNING id`)
      ).rows[0]!.id;
      const secondComboId = (
        await client.query<{ id: number }>(
          `INSERT INTO subject_combinations (course_name) VALUES ('Second Combination') RETURNING id`,
        )
      ).rows[0]!.id;
      await client.query(
        `INSERT INTO subject_combination_subjects (subject_combination_id, subject_id, role) VALUES
           ($1, $2, 'compulsory'), ($1, $3, 'elective')`,
        [secondComboId, world.englishSubjectId, newSubjectId],
      );

      const results = await subjectCombinationReadiness(client);

      expect(results).toHaveLength(2);
      const second = results.find((r) => r.subjectCombinationId === secondComboId);
      const newElective = second?.subjects.find((s) => s.subjectId === newSubjectId);
      expect(newElective).toMatchObject({ approvedCount: 0, requiredCount: 40, ready: false });

      // The first combination's own readiness is unaffected.
      const first = results.find((r) => r.subjectCombinationId !== secondComboId);
      const firstEnglish = first?.subjects.find((s) => s.subjectId === world.englishSubjectId);
      expect(firstEnglish).toMatchObject({ approvedCount: 1, requiredCount: 60 });
    });
  });
});
