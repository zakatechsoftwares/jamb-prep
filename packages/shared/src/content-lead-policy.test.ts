import { describe, expect, it } from 'vitest';
import { aggregateRejectionReasons } from './content-lead-policy';

describe('aggregateRejectionReasons', () => {
  it('sums the same subject+reason across multiple weeks', () => {
    const result = aggregateRejectionReasons([
      { subjectId: 1, week: new Date('2026-01-05'), rejectionReason: 'wrong_key', count: 3 },
      { subjectId: 1, week: new Date('2026-01-12'), rejectionReason: 'wrong_key', count: 5 },
    ]);

    expect(result).toEqual([{ subjectId: 1, rejectionReason: 'wrong_key', count: 8 }]);
  });

  it('keeps different subjects and different reasons as separate totals', () => {
    const result = aggregateRejectionReasons([
      { subjectId: 1, week: new Date('2026-01-05'), rejectionReason: 'wrong_key', count: 3 },
      { subjectId: 1, week: new Date('2026-01-05'), rejectionReason: 'implausible_distractor', count: 2 },
      { subjectId: 2, week: new Date('2026-01-05'), rejectionReason: 'wrong_key', count: 1 },
    ]);

    expect(result).toContainEqual({ subjectId: 1, rejectionReason: 'wrong_key', count: 3 });
    expect(result).toContainEqual({ subjectId: 1, rejectionReason: 'implausible_distractor', count: 2 });
    expect(result).toContainEqual({ subjectId: 2, rejectionReason: 'wrong_key', count: 1 });
  });

  it('sorts the result by descending count, dominant defect first', () => {
    const result = aggregateRejectionReasons([
      { subjectId: 1, week: new Date('2026-01-05'), rejectionReason: 'wrong_key', count: 2 },
      { subjectId: 1, week: new Date('2026-01-05'), rejectionReason: 'implausible_distractor', count: 9 },
      { subjectId: 2, week: new Date('2026-01-05'), rejectionReason: 'off_syllabus', count: 5 },
    ]);

    expect(result.map((r) => r.rejectionReason)).toEqual([
      'implausible_distractor',
      'off_syllabus',
      'wrong_key',
    ]);
  });

  it('returns an empty array for no rejections', () => {
    expect(aggregateRejectionReasons([])).toEqual([]);
  });
});
