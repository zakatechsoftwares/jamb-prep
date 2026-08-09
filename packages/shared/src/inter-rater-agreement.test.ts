import { describe, expect, it } from 'vitest';
import { computeInterRaterAgreement, type DecisionPair } from './inter-rater-agreement';

describe('computeInterRaterAgreement', () => {
  it('reports 100% agreement when every pair in a subject agrees', () => {
    const pairs: DecisionPair[] = [
      { subjectId: 1, firstAction: 'approve', secondAction: 'approve' },
      { subjectId: 1, firstAction: 'reject', secondAction: 'reject' },
    ];
    expect(computeInterRaterAgreement(pairs)).toEqual([
      { subjectId: 1, pairCount: 2, agreementRate: 1 },
    ]);
  });

  it('reports 0% agreement when every pair disagrees', () => {
    const pairs: DecisionPair[] = [
      { subjectId: 1, firstAction: 'approve', secondAction: 'reject' },
    ];
    expect(computeInterRaterAgreement(pairs)).toEqual([
      { subjectId: 1, pairCount: 1, agreementRate: 0 },
    ]);
  });

  it('computes a fractional rate on a handful of mixed pairs', () => {
    const pairs: DecisionPair[] = [
      { subjectId: 1, firstAction: 'approve', secondAction: 'approve' }, // agree
      { subjectId: 1, firstAction: 'approve', secondAction: 'reject' }, // disagree
      { subjectId: 1, firstAction: 'reject', secondAction: 'reject' }, // agree
      { subjectId: 1, firstAction: 'escalate', secondAction: 'approve' }, // disagree
    ];
    expect(computeInterRaterAgreement(pairs)).toEqual([
      { subjectId: 1, pairCount: 4, agreementRate: 0.5 },
    ]);
  });

  it('treats edit_and_approve as an approval for agreement purposes', () => {
    const pairs: DecisionPair[] = [
      { subjectId: 1, firstAction: 'approve', secondAction: 'edit_and_approve' },
    ];
    expect(computeInterRaterAgreement(pairs)).toEqual([
      { subjectId: 1, pairCount: 1, agreementRate: 1 },
    ]);
  });

  it('keeps subjects entirely separate', () => {
    const pairs: DecisionPair[] = [
      { subjectId: 1, firstAction: 'approve', secondAction: 'approve' },
      { subjectId: 2, firstAction: 'approve', secondAction: 'reject' },
      { subjectId: 2, firstAction: 'reject', secondAction: 'approve' },
    ];
    const result = computeInterRaterAgreement(pairs);
    expect(result).toHaveLength(2);
    expect(result).toContainEqual({ subjectId: 1, pairCount: 1, agreementRate: 1 });
    expect(result).toContainEqual({ subjectId: 2, pairCount: 2, agreementRate: 0 });
  });

  it('returns an empty array for no pairs, not an error', () => {
    expect(computeInterRaterAgreement([])).toEqual([]);
  });
});
