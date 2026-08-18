import type { Pool, PoolClient } from 'pg';
import type { ExamConfig, ExamSubjectConfig } from '@jamb/shared';
import { pool } from './client';
import { firstRow } from './first-row';

/**
 * Resolves the active exam blueprint into the exact `ExamConfig` shape
 * `packages/shared/src/scoring.ts` already expects (plan §3, §8.4,
 * canonical session 12). `exam_configs`/`exam_config_subject_rules` (session
 * 06) have existed since migration 0006 but have never been read by
 * application code until this function.
 *
 * The compulsory/elective split in `exam_config_subject_rules` names a
 * *role* and a slot count, not concrete subjects for `elective` — which
 * three subjects fill that role varies per candidate. Resolving a real
 * exam config for a real candidate means joining those roles against the
 * candidate's own `subject_combination_subjects` (migration 0002).
 */
export interface ResolvedExamConfig {
  examConfigId: number;
  config: ExamConfig;
}

interface SubjectRuleRow {
  role: 'compulsory' | 'elective';
  slot_count: number;
  items_per_subject: number;
  marks_per_subject: number;
}

/**
 * The active `exam_configs.id` alone, with no candidate/blueprint
 * resolution — content sync's manifest (plan 8.3, follow-up session) needs
 * this so a Practice session (single subject, no `subject_combination`)
 * still has a real row to satisfy `sessions.exam_config_id`'s `NOT NULL`
 * foreign key, without needing `loadExamConfigForUser`'s full blueprint
 * resolution at all. Null when no `exam_configs` row is marked active.
 */
export async function loadActiveExamConfigId(client?: PoolClient): Promise<number | null> {
  const runner: Pool | PoolClient = client ?? pool;
  const result = await runner.query<{ id: number }>(`SELECT id FROM exam_configs WHERE is_active LIMIT 1`);
  return result.rows[0]?.id ?? null;
}

export async function loadExamConfigForUser(
  userId: number,
  client?: PoolClient,
): Promise<ResolvedExamConfig> {
  const runner: Pool | PoolClient = client ?? pool;

  const examConfig = firstRow(
    await runner.query<{ id: number; total_marks: number }>(
      `SELECT id, total_marks FROM exam_configs WHERE is_active LIMIT 1`,
    ),
  );

  const rules = (
    await runner.query<SubjectRuleRow>(
      `SELECT role, slot_count, items_per_subject, marks_per_subject
         FROM exam_config_subject_rules
        WHERE exam_config_id = $1`,
      [examConfig.id],
    )
  ).rows;

  const user = firstRow(
    await runner.query<{ subject_combination_id: number | null }>(
      `SELECT subject_combination_id FROM users WHERE id = $1`,
      [userId],
    ),
  );
  if (user.subject_combination_id === null) {
    throw new Error(
      `loadExamConfigForUser: user ${userId} has no subject_combination_id — cannot resolve their four exam subjects`,
    );
  }

  const candidateSubjects = (
    await runner.query<{ role: 'compulsory' | 'elective'; subject_id: number }>(
      `SELECT role, subject_id FROM subject_combination_subjects WHERE subject_combination_id = $1`,
      [user.subject_combination_id],
    )
  ).rows;

  const subjects: ExamSubjectConfig[] = [];
  for (const rule of rules) {
    const matchingSubjects = candidateSubjects.filter((row) => row.role === rule.role);
    if (matchingSubjects.length !== rule.slot_count) {
      throw new Error(
        `loadExamConfigForUser: subject combination ${user.subject_combination_id} has ${matchingSubjects.length} '${rule.role}' subject(s), but exam config ${examConfig.id} requires exactly ${rule.slot_count}`,
      );
    }
    for (const subject of matchingSubjects) {
      subjects.push({
        subjectId: subject.subject_id,
        itemsPerSubject: rule.items_per_subject,
        marksPerSubject: rule.marks_per_subject,
      });
    }
  }

  return {
    examConfigId: examConfig.id,
    config: { subjects, totalMarks: examConfig.total_marks },
  };
}
