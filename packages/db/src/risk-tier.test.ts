import { describe, expect, it } from 'vitest';
import { deriveRiskTier } from './risk-tier';

describe('deriveRiskTier', () => {
  it('tags calculation-heavy subjects as high risk', () => {
    expect(deriveRiskTier('Mathematics')).toBe('high');
    expect(deriveRiskTier('Physics')).toBe('high');
    expect(deriveRiskTier('Chemistry')).toBe('high');
  });

  it('tags the remaining seed subjects as low risk', () => {
    expect(deriveRiskTier('Use of English')).toBe('low');
    expect(deriveRiskTier('Biology')).toBe('low');
  });
});
