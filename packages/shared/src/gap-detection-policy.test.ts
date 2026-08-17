import { describe, expect, it } from 'vitest';
import { detectCoverageGaps, type ObjectiveCoverage } from './gap-detection-policy';

function coverage(overrides: Partial<ObjectiveCoverage> = {}): ObjectiveCoverage {
  return {
    objectiveId: 1,
    approvedCount: 5,
    targetItemCount: 10,
    requiresHumanAuthorship: false,
    ...overrides,
  };
}

describe('detectCoverageGaps', () => {
  it('returns nothing for an empty list', () => {
    expect(detectCoverageGaps([])).toEqual([]);
  });

  it('flags an objective whose approved count is below its target', () => {
    expect(detectCoverageGaps([coverage({ objectiveId: 1, approvedCount: 4, targetItemCount: 10 })])).toEqual([
      { objectiveId: 1, deficit: 6, requiresHumanAuthorship: false },
    ]);
  });

  it('does not flag an objective that has met its target', () => {
    expect(detectCoverageGaps([coverage({ approvedCount: 10, targetItemCount: 10 })])).toEqual([]);
  });

  it('does not flag an objective that has exceeded its target', () => {
    expect(detectCoverageGaps([coverage({ approvedCount: 15, targetItemCount: 10 })])).toEqual([]);
  });

  it('carries requiresHumanAuthorship through to the gap unchanged', () => {
    const gaps = detectCoverageGaps([
      coverage({ objectiveId: 1, approvedCount: 0, targetItemCount: 5, requiresHumanAuthorship: true }),
    ]);
    expect(gaps).toEqual([{ objectiveId: 1, deficit: 5, requiresHumanAuthorship: true }]);
  });

  it('sorts multiple gaps by deficit, largest first', () => {
    const gaps = detectCoverageGaps([
      coverage({ objectiveId: 1, approvedCount: 8, targetItemCount: 10 }), // deficit 2
      coverage({ objectiveId: 2, approvedCount: 0, targetItemCount: 10 }), // deficit 10
      coverage({ objectiveId: 3, approvedCount: 5, targetItemCount: 10 }), // deficit 5
    ]);
    expect(gaps.map((g) => g.objectiveId)).toEqual([2, 3, 1]);
  });

  it('mixes gapped and non-gapped objectives correctly', () => {
    const gaps = detectCoverageGaps([
      coverage({ objectiveId: 1, approvedCount: 10, targetItemCount: 10 }),
      coverage({ objectiveId: 2, approvedCount: 3, targetItemCount: 10 }),
    ]);
    expect(gaps).toEqual([{ objectiveId: 2, deficit: 7, requiresHumanAuthorship: false }]);
  });

  it('throws when approvedCount is negative', () => {
    expect(() => detectCoverageGaps([coverage({ approvedCount: -1 })])).toThrow(/approvedCount/);
  });

  it('throws when approvedCount is not an integer', () => {
    expect(() => detectCoverageGaps([coverage({ approvedCount: 2.5 })])).toThrow(/approvedCount/);
  });

  it('throws when targetItemCount is zero or negative', () => {
    expect(() => detectCoverageGaps([coverage({ targetItemCount: 0 })])).toThrow(/targetItemCount/);
    expect(() => detectCoverageGaps([coverage({ targetItemCount: -5 })])).toThrow(/targetItemCount/);
  });

  it('throws when targetItemCount is not an integer', () => {
    expect(() => detectCoverageGaps([coverage({ targetItemCount: 3.5 })])).toThrow(/targetItemCount/);
  });

  it('throws when objectiveId is not a positive integer', () => {
    expect(() => detectCoverageGaps([coverage({ objectiveId: 0 })])).toThrow(/objectiveId/);
    expect(() => detectCoverageGaps([coverage({ objectiveId: -1 })])).toThrow(/objectiveId/);
  });
});
