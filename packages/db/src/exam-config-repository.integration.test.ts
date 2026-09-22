import { afterAll, beforeEach, describe, expect, it } from 'vitest';

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.runIf(hasDatabase)('exam-config-repository', () => {
  async function withWorld<T>(
    run: (context: {
      client: import('pg').PoolClient;
      world: import('./exam-session.fixtures').ExamWorld;
      loadExamConfigForUser: typeof import('./exam-config-repository').loadExamConfigForUser;
      loadActiveExamConfigId: typeof import('./exam-config-repository').loadActiveExamConfigId;
      loadActiveExamConfigRules: typeof import('./exam-config-repository').loadActiveExamConfigRules;
    }) => Promise<T>,
  ): Promise<T> {
    const { pool } = await import('./client');
    const { seedExamWorld } = await import('./exam-session.fixtures');
    const { loadExamConfigForUser, loadActiveExamConfigId, loadActiveExamConfigRules } = await import(
      './exam-config-repository'
    );
    const client = await pool.connect();

    try {
      const world = await seedExamWorld(client);
      return await run({ client, world, loadExamConfigForUser, loadActiveExamConfigId, loadActiveExamConfigRules });
    } finally {
      client.release();
    }
  }

  describe('loadActiveExamConfigId', () => {
    it('returns the active exam_configs id, with no candidate/blueprint resolution needed', async () => {
      await withWorld(async ({ client, world, loadActiveExamConfigId }) => {
        expect(await loadActiveExamConfigId(client)).toBe(world.examConfigId);
      });
    });

    it('returns null when nothing is active', async () => {
      await withWorld(async ({ client, loadActiveExamConfigId }) => {
        await client.query(`UPDATE exam_configs SET is_active = false`);
        expect(await loadActiveExamConfigId(client)).toBeNull();
      });
    });
  });

  describe('loadActiveExamConfigRules', () => {
    it('returns the active exam config and its role-level rules, with no candidate resolution', async () => {
      await withWorld(async ({ client, world, loadActiveExamConfigRules }) => {
        const resolved = await loadActiveExamConfigRules(client);

        expect(resolved.examConfigId).toBe(world.examConfigId);
        expect(resolved.totalMarks).toBe(400);
        expect(resolved.rules).toHaveLength(2);

        const compulsory = resolved.rules.find((rule) => rule.role === 'compulsory');
        expect(compulsory).toEqual({ role: 'compulsory', slotCount: 1, itemsPerSubject: 60, marksPerSubject: 100 });

        const elective = resolved.rules.find((rule) => rule.role === 'elective');
        expect(elective).toEqual({ role: 'elective', slotCount: 3, itemsPerSubject: 40, marksPerSubject: 100 });
      });
    });

    it('throws when no exam_configs row is active', async () => {
      await withWorld(async ({ client, loadActiveExamConfigRules }) => {
        await client.query(`UPDATE exam_configs SET is_active = false`);
        await expect(loadActiveExamConfigRules(client)).rejects.toThrow();
      });
    });
  });

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

  it('resolves the four subjects (one compulsory, three elective) with the rule counts and marks', async () => {
    await withWorld(async ({ client, world, loadExamConfigForUser }) => {
      const resolved = await loadExamConfigForUser(world.userId, client);

      expect(resolved.examConfigId).toBe(world.examConfigId);
      expect(resolved.config.totalMarks).toBe(400);
      expect(resolved.config.subjects).toHaveLength(4);

      const english = resolved.config.subjects.find((s) => s.subjectId === world.englishSubjectId);
      expect(english).toEqual({ subjectId: world.englishSubjectId, itemsPerSubject: 60, marksPerSubject: 100 });

      for (const electiveId of world.electiveSubjectIds) {
        const elective = resolved.config.subjects.find((s) => s.subjectId === electiveId);
        expect(elective).toEqual({ subjectId: electiveId, itemsPerSubject: 40, marksPerSubject: 100 });
      }
    });
  });

  it('throws when the user has no subject_combination_id', async () => {
    await withWorld(async ({ client, loadExamConfigForUser }) => {
      const noComboUserId = (
        await client.query<{ id: number }>(
          `INSERT INTO users (full_name, phone, exam_year) VALUES ('No Combo', '__no_combo__', 2026) RETURNING id`,
        )
      ).rows[0]!.id;

      await expect(loadExamConfigForUser(noComboUserId, client)).rejects.toThrow(
        /subject_combination_id/,
      );
    });
  });

  it('throws when the subject combination does not satisfy a rule\'s slot count', async () => {
    await withWorld(async ({ client, world, loadExamConfigForUser }) => {
      // Give this combination only 2 electives instead of the required 3.
      await client.query(
        `DELETE FROM subject_combination_subjects
          WHERE subject_id = $1 AND role = 'elective'`,
        [world.electiveSubjectIds[2]],
      );
      const shortComboUserId = (
        await client.query<{ subject_combination_id: number }>(
          `SELECT subject_combination_id FROM users WHERE id = $1`,
          [world.userId],
        )
      ).rows[0]!.subject_combination_id;

      const newUserId = (
        await client.query<{ id: number }>(
          `INSERT INTO users (full_name, phone, exam_year, subject_combination_id)
           VALUES ('Short Combo', '__short_combo__', 2026, $1) RETURNING id`,
          [shortComboUserId],
        )
      ).rows[0]!.id;

      await expect(loadExamConfigForUser(newUserId, client)).rejects.toThrow(/slot_count|requires exactly/);
    });
  });
});
