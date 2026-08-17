import type { PoolClient } from 'pg';
import { firstRow } from './first-row';
import { truncateQueueWorld } from './review-queue.fixtures';

/**
 * Fixtures for the exam-session integration tests (canonical session 12).
 * Reuses `truncateQueueWorld` for cleanup rather than reimplementing it —
 * it already reaches `exam_configs`/`subject_combinations` (fixed alongside
 * this session, see its own comment) and every other table this fixture
 * touches.
 */
export interface ExamWorld {
  englishSubjectId: number;
  electiveSubjectIds: [number, number, number];
  examConfigId: number;
  userId: number;
  /** One item per subject, correct option always 'A'. */
  itemIds: { englishItemId: number; electiveItemIds: [number, number, number] };
}

async function insertSubject(client: PoolClient, name: string): Promise<number> {
  return firstRow(
    await client.query<{ id: number }>(`INSERT INTO subjects (name) VALUES ($1) RETURNING id`, [name]),
  ).id;
}

async function insertItem(client: PoolClient, subjectId: number): Promise<number> {
  const topicId = firstRow(
    await client.query<{ id: number }>(
      `INSERT INTO topics (subject_id, name) VALUES ($1, 'Topic') RETURNING id`,
      [subjectId],
    ),
  ).id;
  const subtopicId = firstRow(
    await client.query<{ id: number }>(
      `INSERT INTO subtopics (topic_id, name) VALUES ($1, 'Subtopic') RETURNING id`,
      [topicId],
    ),
  ).id;
  const objectiveId = firstRow(
    await client.query<{ id: number }>(
      `INSERT INTO objectives (subtopic_id, description) VALUES ($1, 'Objective') RETURNING id`,
      [subtopicId],
    ),
  ).id;
  const itemId = firstRow(
    await client.query<{ id: number }>(
      `INSERT INTO items (
         subject_id, topic_id, subtopic_id, objective_id, stem, explanation,
         cognitive_level, expected_time_seconds, risk_tier,
         independent_solve_verdict, sampled_for_review, status
       ) VALUES ($1, $2, $3, $4, 'stem', 'explanation', 'recall', 60, 'low', 'agreed', true, 'approved_calibrated')
       RETURNING id`,
      [subjectId, topicId, subtopicId, objectiveId],
    ),
  ).id;
  for (const label of ['A', 'B', 'C', 'D']) {
    await client.query(
      `INSERT INTO item_options (item_id, label, option_text, is_correct) VALUES ($1, $2, $3, $4)`,
      [itemId, label, `option ${label}`, label === 'A'],
    );
  }
  return itemId;
}

/** A 2026-shaped exam config (60/40/40/40, 400 marks), a matching subject combination, and one candidate. Deliberately uses exam_year 2099 so it never collides with a real seeded config sharing this database. */
export async function seedExamWorld(client: PoolClient): Promise<ExamWorld> {
  await truncateQueueWorld(client);

  const englishSubjectId = await insertSubject(client, 'Use of English');
  const electiveSubjectIds: [number, number, number] = [
    await insertSubject(client, 'Biology'),
    await insertSubject(client, 'Chemistry'),
    await insertSubject(client, 'Physics'),
  ];

  const examConfigId = firstRow(
    await client.query<{ id: number }>(
      `INSERT INTO exam_configs (exam_year, version, total_duration_minutes, total_marks, negative_marking, is_active)
       VALUES (2099, 1, 120, 400, false, true) RETURNING id`,
    ),
  ).id;

  await client.query(
    `INSERT INTO exam_config_subject_rules (exam_config_id, role, subject_id, slot_count, items_per_subject, marks_per_subject)
     VALUES ($1, 'compulsory', $2, 1, 60, 100)`,
    [examConfigId, englishSubjectId],
  );
  await client.query(
    `INSERT INTO exam_config_subject_rules (exam_config_id, role, subject_id, slot_count, items_per_subject, marks_per_subject)
     VALUES ($1, 'elective', NULL, 3, 40, 100)`,
    [examConfigId],
  );

  const combinationId = firstRow(
    await client.query<{ id: number }>(
      `INSERT INTO subject_combinations (course_name) VALUES ('Test Combination') RETURNING id`,
    ),
  ).id;
  await client.query(
    `INSERT INTO subject_combination_subjects (subject_combination_id, subject_id, role) VALUES
       ($1, $2, 'compulsory'), ($1, $3, 'elective'), ($1, $4, 'elective'), ($1, $5, 'elective')`,
    [combinationId, englishSubjectId, ...electiveSubjectIds],
  );

  const userId = firstRow(
    await client.query<{ id: number }>(
      `INSERT INTO users (full_name, phone, exam_year, subject_combination_id)
       VALUES ('Test Candidate', '__exam_candidate__', 2026, $1) RETURNING id`,
      [combinationId],
    ),
  ).id;

  const englishItemId = await insertItem(client, englishSubjectId);
  const electiveItemIds: [number, number, number] = [
    await insertItem(client, electiveSubjectIds[0]),
    await insertItem(client, electiveSubjectIds[1]),
    await insertItem(client, electiveSubjectIds[2]),
  ];

  return {
    englishSubjectId,
    electiveSubjectIds,
    examConfigId,
    userId,
    itemIds: { englishItemId, electiveItemIds },
  };
}
