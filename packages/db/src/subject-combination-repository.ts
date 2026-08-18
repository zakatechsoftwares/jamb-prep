import type { Pool, PoolClient } from 'pg';
import { pool } from './client';

/**
 * Subject-combination onboarding (the structural prerequisite content
 * sync's own build-log entry named as the real blocker to Mock mode for a
 * real candidate — `loadExamConfigForUser` throws without a
 * `users.subject_combination_id`, and nothing before this set one).
 */
export interface SubjectCombinationSubject {
  subjectId: number;
  subjectName: string;
  role: 'compulsory' | 'elective';
}

export interface SubjectCombinationSummary {
  id: number;
  courseName: string;
  subjects: SubjectCombinationSubject[];
}

export async function listSubjectCombinations(client?: PoolClient): Promise<SubjectCombinationSummary[]> {
  const runner: Pool | PoolClient = client ?? pool;

  const result = await runner.query<{
    id: number;
    course_name: string;
    subject_id: number;
    subject_name: string;
    role: 'compulsory' | 'elective';
  }>(
    `SELECT sc.id, sc.course_name, s.id AS subject_id, s.name AS subject_name, scs.role
       FROM subject_combinations sc
       JOIN subject_combination_subjects scs ON scs.subject_combination_id = sc.id
       JOIN subjects s ON s.id = scs.subject_id
      ORDER BY sc.id, scs.role, s.name`,
  );

  const byId = new Map<number, SubjectCombinationSummary>();
  for (const row of result.rows) {
    const entry = byId.get(row.id) ?? { id: row.id, courseName: row.course_name, subjects: [] };
    entry.subjects.push({ subjectId: row.subject_id, subjectName: row.subject_name, role: row.role });
    byId.set(row.id, entry);
  }

  return [...byId.values()].sort((a, b) => a.id - b.id);
}

export class SubjectCombinationNotFoundError extends Error {
  constructor(public readonly subjectCombinationId: number) {
    super(`subject combination ${subjectCombinationId} not found`);
    this.name = 'SubjectCombinationNotFoundError';
  }
}

/**
 * Freely reassignable — no "already chosen" guard. A candidate changing
 * their mind about their course before ever sitting a real exam isn't a
 * scenario worth defending against, matching how every other
 * candidate-facing write in this app stays simple rather than guarding
 * against a problem that doesn't actually exist here.
 */
export async function setCandidateSubjectCombination(
  userId: number,
  subjectCombinationId: number,
  client?: PoolClient,
): Promise<void> {
  const runner: Pool | PoolClient = client ?? pool;

  const exists = await runner.query(`SELECT 1 FROM subject_combinations WHERE id = $1`, [
    subjectCombinationId,
  ]);
  if (exists.rows.length === 0) {
    throw new SubjectCombinationNotFoundError(subjectCombinationId);
  }

  await runner.query(`UPDATE users SET subject_combination_id = $2 WHERE id = $1`, [
    userId,
    subjectCombinationId,
  ]);
}
