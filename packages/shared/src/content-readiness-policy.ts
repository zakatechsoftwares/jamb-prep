/**
 * Subject-combination Mock-exam readiness: does every subject in a
 * candidate's course have enough *approved* items to fill the active exam
 * blueprint's role-level requirement (`items_per_subject` is keyed by role,
 * not by concrete subject — see `exam_config_subject_rules`)? Pure
 * comparison, no I/O — `packages/db` supplies the combinations, the
 * role-level requirement, and each subject's live approved count.
 *
 * Deliberately subject-level, not objective-level — `gap-detection-policy.ts`
 * answers a different, finer-grained question (which objectives need a
 * brief) for the brief board; this answers "can a candidate sit a full
 * Mock exam in this course today."
 *
 * `CombinationSubjectInput`/`SubjectCombinationInput` are declared
 * independently from `subject-combination-repository.ts`'s
 * `SubjectCombinationSummary` — `packages/shared` has no dependency on
 * `packages/db` (see `packages/shared/package.json`), so this can't import
 * that type. They're structurally identical, so a caller's real
 * `SubjectCombinationSummary[]` is directly assignable with no conversion.
 */
export interface CombinationSubjectInput {
  subjectId: number;
  subjectName: string;
  role: 'compulsory' | 'elective';
}

export interface SubjectCombinationInput {
  id: number;
  courseName: string;
  subjects: CombinationSubjectInput[];
}

export interface SubjectReadiness {
  subjectId: number;
  subjectName: string;
  role: 'compulsory' | 'elective';
  approvedCount: number;
  requiredCount: number;
  ready: boolean;
}

export interface SubjectCombinationReadiness {
  subjectCombinationId: number;
  courseName: string;
  subjects: SubjectReadiness[];
  /** True iff every subject in this combination is ready. */
  ready: boolean;
}

function assertNonNegativeInteger(value: number, fieldName: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      `computeSubjectCombinationReadiness: ${fieldName} must be a non-negative whole number, got ${value}`,
    );
  }
}

function assertPositiveInteger(value: number, fieldName: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(
      `computeSubjectCombinationReadiness: ${fieldName} must be a positive whole number, got ${value}`,
    );
  }
}

/**
 * A subject missing from `approvedCountBySubjectId` is treated as 0, never
 * an error — a `GROUP BY` over live items simply omits a subject with no
 * approved items yet, and that is not a distinct case from "zero."
 *
 * No sorting logic here — the caller's `combinations`/`subjects` ordering
 * (already meaningful, e.g. `listSubjectCombinations`'s own `role, name`
 * ordering) is preserved rather than re-derived.
 */
export function computeSubjectCombinationReadiness(
  combinations: SubjectCombinationInput[],
  requiredCountByRole: Record<'compulsory' | 'elective', number>,
  approvedCountBySubjectId: ReadonlyMap<number, number>,
): SubjectCombinationReadiness[] {
  assertPositiveInteger(requiredCountByRole.compulsory, 'requiredCountByRole.compulsory');
  assertPositiveInteger(requiredCountByRole.elective, 'requiredCountByRole.elective');

  return combinations.map((combination) => {
    assertPositiveInteger(combination.id, 'combination.id');

    const subjects: SubjectReadiness[] = combination.subjects.map((subject) => {
      assertPositiveInteger(subject.subjectId, 'subject.subjectId');
      const approvedCount = approvedCountBySubjectId.get(subject.subjectId) ?? 0;
      assertNonNegativeInteger(approvedCount, 'approvedCount');
      const requiredCount = requiredCountByRole[subject.role];
      return {
        subjectId: subject.subjectId,
        subjectName: subject.subjectName,
        role: subject.role,
        approvedCount,
        requiredCount,
        ready: approvedCount >= requiredCount,
      };
    });

    return {
      subjectCombinationId: combination.id,
      courseName: combination.courseName,
      subjects,
      ready: subjects.every((subject) => subject.ready),
    };
  });
}
