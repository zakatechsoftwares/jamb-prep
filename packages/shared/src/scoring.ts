export interface ExamSubjectConfig {
  subjectId: number;
  itemsPerSubject: number;
  marksPerSubject: number;
}

/**
 * The resolved, per-subject blueprint for one exam sitting (plan section
 * 8.4 / 3): item counts and marks come from here, never from a constant.
 *
 * No `negativeMarking` field, by design, not by omission: the blueprint
 * never applies negative marking, so this is a fixed invariant of the
 * scoring algorithm, not a toggle. A wrong or unanswered item always scores
 * exactly 0. If that ever changes, it's a new scoring algorithm, not a flag
 * on this one — see packages/shared/README.md.
 */
export interface ExamConfig {
  subjects: ExamSubjectConfig[];
  totalMarks: number;
}

/**
 * One response to one item. `sequence` orders re-answers of the same item
 * (attempts are append-only — CLAUDE.md rule 2 — so a changed answer is a
 * new row, not an update) and must be unique per item; see
 * packages/shared/README.md for how callers should derive it from the
 * `attempts` table.
 */
export interface ScoringAttempt {
  itemId: number;
  subjectId: number;
  isCorrect: boolean;
  sequence: number;
}

export interface SubjectScore {
  subjectId: number;
  score: number;
  maxMarks: number;
}

export interface ScoreResult {
  subjectScores: SubjectScore[];
  aggregateScore: number;
  aggregateMaxMarks: number;
}

function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}

interface ItemResolution {
  latest: ScoringAttempt;
  seenSequences: Set<number>;
}

function resolveLatestAttemptPerItem(attempts: ScoringAttempt[]): ScoringAttempt[] {
  const resolutionByItem = new Map<number, ItemResolution>();

  for (const attempt of attempts) {
    const resolution = resolutionByItem.get(attempt.itemId);

    if (!resolution) {
      resolutionByItem.set(attempt.itemId, {
        latest: attempt,
        seenSequences: new Set([attempt.sequence]),
      });
      continue;
    }

    // Checked against every sequence seen so far for this item, not just
    // the running maximum — [5, 7, 5] must throw on the second 5, even
    // though 7 (not 5) is the current winner at that point.
    if (resolution.seenSequences.has(attempt.sequence)) {
      throw new Error(
        `scoreExam: item ${attempt.itemId} has two attempts with the same sequence (${attempt.sequence}) — sequence must be unique per item`,
      );
    }
    resolution.seenSequences.add(attempt.sequence);

    if (attempt.sequence > resolution.latest.sequence) {
      resolution.latest = attempt;
    }
  }

  return [...resolutionByItem.values()].map((resolution) => resolution.latest);
}

function assertConsistentTotalMarks(config: ExamConfig): void {
  const summedMarks = config.subjects.reduce((sum, subject) => sum + subject.marksPerSubject, 0);

  if (summedMarks !== config.totalMarks) {
    throw new Error(
      `scoreExam: config.totalMarks is ${config.totalMarks}, but the subjects sum to ${summedMarks} — an exam config must be internally consistent`,
    );
  }
}

function assertKnownSubjects(config: ExamConfig, attempts: ScoringAttempt[]): void {
  const knownSubjectIds = new Set(config.subjects.map((subject) => subject.subjectId));

  for (const attempt of attempts) {
    if (!knownSubjectIds.has(attempt.subjectId)) {
      throw new Error(
        `scoreExam: attempt for item ${attempt.itemId} references subject ${attempt.subjectId}, which is not in the exam config`,
      );
    }
  }
}

/**
 * Scores one exam sitting: per-subject marks out of each subject's
 * marksPerSubject, and an aggregate out of config.totalMarks. Pure and
 * dependency-free — no DB access, no I/O.
 *
 * Throws rather than silently tolerating a mismatch between attempts and
 * config: an attempt for a subject the config doesn't know about, or more
 * distinct items for a subject than its itemsPerSubject allows, means
 * attempts from the wrong session or the wrong config landed here, which is
 * a bug worth surfacing immediately rather than scoring around. Also throws
 * if the config itself is internally inconsistent (totalMarks not matching
 * the sum of marksPerSubject) — exam configs are hand-edited versioned
 * data, and a broken one should not produce a silently wrong score.
 */
export function scoreExam(config: ExamConfig, attempts: ScoringAttempt[]): ScoreResult {
  assertConsistentTotalMarks(config);
  assertKnownSubjects(config, attempts);

  const resolvedAttempts = resolveLatestAttemptPerItem(attempts);

  const itemCountBySubject = new Map<number, number>();
  const correctCountBySubject = new Map<number, number>();

  for (const attempt of resolvedAttempts) {
    itemCountBySubject.set(attempt.subjectId, (itemCountBySubject.get(attempt.subjectId) ?? 0) + 1);

    if (attempt.isCorrect) {
      correctCountBySubject.set(
        attempt.subjectId,
        (correctCountBySubject.get(attempt.subjectId) ?? 0) + 1,
      );
    }
  }

  const subjectScores: SubjectScore[] = config.subjects.map((subject) => {
    const distinctItemCount = itemCountBySubject.get(subject.subjectId) ?? 0;

    if (distinctItemCount > subject.itemsPerSubject) {
      throw new Error(
        `scoreExam: subject ${subject.subjectId} has attempts for ${distinctItemCount} distinct items, but itemsPerSubject is ${subject.itemsPerSubject}`,
      );
    }

    const correctCount = correctCountBySubject.get(subject.subjectId) ?? 0;
    const score = roundHalfUp((correctCount / subject.itemsPerSubject) * subject.marksPerSubject);

    return { subjectId: subject.subjectId, score, maxMarks: subject.marksPerSubject };
  });

  const aggregateScore = subjectScores.reduce((sum, subjectScore) => sum + subjectScore.score, 0);

  return {
    subjectScores,
    aggregateScore,
    aggregateMaxMarks: config.totalMarks,
  };
}
