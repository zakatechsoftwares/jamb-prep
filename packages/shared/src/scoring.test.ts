import { describe, expect, it } from 'vitest';
import { scoreExam, type ExamConfig, type ScoringAttempt } from './scoring';

const STANDARD_CONFIG: ExamConfig = {
  totalMarks: 400,
  subjects: [
    { subjectId: 1, itemsPerSubject: 60, marksPerSubject: 100 },
    { subjectId: 2, itemsPerSubject: 40, marksPerSubject: 100 },
    { subjectId: 3, itemsPerSubject: 40, marksPerSubject: 100 },
    { subjectId: 4, itemsPerSubject: 40, marksPerSubject: 100 },
  ],
};

function correctAttempt(itemId: number, subjectId: number, sequence = 1): ScoringAttempt {
  return { itemId, subjectId, isCorrect: true, sequence };
}

function wrongAttempt(itemId: number, subjectId: number, sequence = 1): ScoringAttempt {
  return { itemId, subjectId, isCorrect: false, sequence };
}

// Distinct items for a subject, one attempt each — itemIds are namespaced by
// subjectId so bulk-generated fixtures never collide across subjects.
function distinctCorrectAttempts(
  subjectId: number,
  count: number,
  itemIdOffset = 0,
): ScoringAttempt[] {
  return Array.from({ length: count }, (_, i) =>
    correctAttempt(subjectId * 1000 + itemIdOffset + i, subjectId),
  );
}

function distinctWrongAttempts(
  subjectId: number,
  count: number,
  itemIdOffset = 0,
): ScoringAttempt[] {
  return Array.from({ length: count }, (_, i) =>
    wrongAttempt(subjectId * 1000 + itemIdOffset + i, subjectId),
  );
}

describe('scoreExam', () => {
  it('awards full marks per subject and the full aggregate when every item is answered correctly', () => {
    const attempts = STANDARD_CONFIG.subjects.flatMap((subject) =>
      distinctCorrectAttempts(subject.subjectId, subject.itemsPerSubject),
    );

    const result = scoreExam(STANDARD_CONFIG, attempts);

    expect(result.subjectScores).toEqual([
      { subjectId: 1, score: 100, maxMarks: 100 },
      { subjectId: 2, score: 100, maxMarks: 100 },
      { subjectId: 3, score: 100, maxMarks: 100 },
      { subjectId: 4, score: 100, maxMarks: 100 },
    ]);
    expect(result.aggregateScore).toBe(400);
    expect(result.aggregateMaxMarks).toBe(400);
  });

  it('scores zero on every subject when nothing is answered', () => {
    const result = scoreExam(STANDARD_CONFIG, []);

    expect(result.subjectScores).toEqual([
      { subjectId: 1, score: 0, maxMarks: 100 },
      { subjectId: 2, score: 0, maxMarks: 100 },
      { subjectId: 3, score: 0, maxMarks: 100 },
      { subjectId: 4, score: 0, maxMarks: 100 },
    ]);
    expect(result.aggregateScore).toBe(0);
  });

  it('scores a partial attempt proportionally, with wrong answers costing only the lost mark (no negative marking)', () => {
    const config: ExamConfig = {
      totalMarks: 100,
      subjects: [{ subjectId: 1, itemsPerSubject: 40, marksPerSubject: 100 }],
    };
    const attempts = [...distinctCorrectAttempts(1, 30), ...distinctWrongAttempts(1, 10, 30)];

    const result = scoreExam(config, attempts);

    expect(result.subjectScores).toEqual([{ subjectId: 1, score: 75, maxMarks: 100 }]);
    expect(result.aggregateScore).toBe(75);
  });

  it('scores unanswered items as zero, identically to a wrong answer', () => {
    const config: ExamConfig = {
      totalMarks: 100,
      subjects: [{ subjectId: 1, itemsPerSubject: 10, marksPerSubject: 100 }],
    };
    // Only 6 of the 10 items in this subject have an attempt at all — the
    // remaining 4 were never answered, and never appear in the attempts list.
    const attempts = distinctCorrectAttempts(1, 6);

    const result = scoreExam(config, attempts);

    expect(result.subjectScores).toEqual([{ subjectId: 1, score: 60, maxMarks: 100 }]);
  });

  it('reads item counts and marks entirely from the config, never from a built-in constant', () => {
    const nonStandardConfig: ExamConfig = {
      totalMarks: 50,
      subjects: [{ subjectId: 1, itemsPerSubject: 7, marksPerSubject: 50 }],
    };
    const attempts = distinctCorrectAttempts(1, 3);

    const result = scoreExam(nonStandardConfig, attempts);

    // 3/7 * 50 = 21.42857... — a number that only falls out if itemsPerSubject
    // and marksPerSubject came from this config, not from a hard-coded
    // 40/60-item, 100-mark assumption.
    expect(result.subjectScores).toEqual([{ subjectId: 1, score: 21, maxMarks: 50 }]);
    expect(result.aggregateMaxMarks).toBe(50);
  });

  it('rounds an exact half-mark boundary up to the nearest whole mark', () => {
    const config: ExamConfig = {
      totalMarks: 100,
      subjects: [{ subjectId: 1, itemsPerSubject: 8, marksPerSubject: 100 }],
    };

    // 1/8 * 100 = 12.5 exactly.
    expect(scoreExam(config, distinctCorrectAttempts(1, 1)).subjectScores[0]?.score).toBe(13);
    // 3/8 * 100 = 37.5 exactly.
    expect(scoreExam(config, distinctCorrectAttempts(1, 3)).subjectScores[0]?.score).toBe(38);
  });

  describe('append-only attempts: only the latest attempt per item counts', () => {
    const singleItemConfig: ExamConfig = {
      totalMarks: 100,
      subjects: [{ subjectId: 1, itemsPerSubject: 1, marksPerSubject: 100 }],
    };

    it('right then wrong scores as wrong (0)', () => {
      const attempts: ScoringAttempt[] = [correctAttempt(1, 1, 1), wrongAttempt(1, 1, 2)];

      const result = scoreExam(singleItemConfig, attempts);

      expect(result.subjectScores).toEqual([{ subjectId: 1, score: 0, maxMarks: 100 }]);
    });

    it('wrong then right scores as right (full marks)', () => {
      const attempts: ScoringAttempt[] = [wrongAttempt(1, 1, 1), correctAttempt(1, 1, 2)];

      const result = scoreExam(singleItemConfig, attempts);

      expect(result.subjectScores).toEqual([{ subjectId: 1, score: 100, maxMarks: 100 }]);
    });

    it('right then right still counts once, not twice', () => {
      const twoItemConfig: ExamConfig = {
        totalMarks: 100,
        subjects: [{ subjectId: 1, itemsPerSubject: 2, marksPerSubject: 100 }],
      };
      // Item 1 answered correctly twice (a re-answer that didn't change the
      // outcome); item 2 is left unanswered. If the re-answer were double
      // counted, this would wrongly score 100 instead of 50.
      const attempts: ScoringAttempt[] = [correctAttempt(1, 1, 1), correctAttempt(1, 1, 2)];

      const result = scoreExam(twoItemConfig, attempts);

      expect(result.subjectScores).toEqual([{ subjectId: 1, score: 50, maxMarks: 100 }]);
    });

    it('throws when two attempts for the same item share a sequence value', () => {
      // created_at can tie under offline sync — see README. A duplicate
      // sequence for the same item is a data integrity bug, not something
      // to resolve by guessing at array order.
      const attempts: ScoringAttempt[] = [wrongAttempt(1, 1, 5), correctAttempt(1, 1, 5)];

      expect(() => scoreExam(singleItemConfig, attempts)).toThrow(/sequence/i);
    });

    it('throws on a duplicate sequence anywhere in the history, not only against the running maximum', () => {
      // 5, 7, 5 — the second 5 collides with the first attempt, not with
      // the current winner (7 at that point). A duplicate anywhere in the
      // item's history must still be caught, not silently dropped.
      const attempts: ScoringAttempt[] = [
        correctAttempt(1, 1, 5),
        wrongAttempt(1, 1, 7),
        correctAttempt(1, 1, 5),
      ];

      expect(() => scoreExam(singleItemConfig, attempts)).toThrow(/sequence/i);
    });
  });

  describe('validates the config itself, independent of any attempts', () => {
    it('throws when totalMarks does not equal the sum of marksPerSubject across subjects', () => {
      // Sum of marksPerSubject is 300 (100 + 100 + 100), but totalMarks
      // claims 400 — a hand-edited config gone stale, e.g. a subject
      // removed without updating the total.
      const inconsistentConfig: ExamConfig = {
        totalMarks: 400,
        subjects: [
          { subjectId: 1, itemsPerSubject: 60, marksPerSubject: 100 },
          { subjectId: 2, itemsPerSubject: 40, marksPerSubject: 100 },
          { subjectId: 3, itemsPerSubject: 40, marksPerSubject: 100 },
        ],
      };

      expect(() => scoreExam(inconsistentConfig, [])).toThrow(/totalMarks/i);
    });
  });

  describe('validates attempts against the config instead of silently tolerating a mismatch', () => {
    it('throws when an attempt references a subject not present in the config', () => {
      const attempts: ScoringAttempt[] = [
        { itemId: 1, subjectId: 999, isCorrect: true, sequence: 1 },
      ];

      expect(() => scoreExam(STANDARD_CONFIG, attempts)).toThrow(/subject/i);
    });

    it('throws even when the offending row is a superseded (non-latest) attempt for its item', () => {
      const config: ExamConfig = {
        totalMarks: 100,
        subjects: [{ subjectId: 1, itemsPerSubject: 1, marksPerSubject: 100 }],
      };
      const attempts: ScoringAttempt[] = [
        { itemId: 1, subjectId: 999, isCorrect: true, sequence: 1 }, // wrong session's data, stale
        { itemId: 1, subjectId: 1, isCorrect: true, sequence: 2 }, // valid, latest
      ];

      expect(() => scoreExam(config, attempts)).toThrow(/subject/i);
    });

    it('throws when more distinct items are attempted for a subject than itemsPerSubject allows', () => {
      const twoItemConfig: ExamConfig = {
        totalMarks: 100,
        subjects: [{ subjectId: 1, itemsPerSubject: 2, marksPerSubject: 100 }],
      };
      // Item 1 re-answered (unremarkable on its own), plus two more distinct
      // items than this subject's itemsPerSubject allows for. That's items
      // from the wrong config or the wrong session leaking in — a bug to
      // surface loudly, not an input to cap and silently accept.
      const attempts: ScoringAttempt[] = [
        correctAttempt(1, 1, 1),
        correctAttempt(1, 1, 2),
        correctAttempt(2, 1, 1),
        correctAttempt(3, 1, 1),
      ];

      expect(() => scoreExam(twoItemConfig, attempts)).toThrow(/item/i);
    });
  });
});
