import { describe, expect, it } from 'vitest';
import { deriveRiskTier } from './risk-tier';

describe('deriveRiskTier', () => {
  it('tags calculation-heavy subjects as high risk', () => {
    expect(deriveRiskTier('Mathematics', false)).toBe('high');
    expect(deriveRiskTier('Physics', false)).toBe('high');
    expect(deriveRiskTier('Chemistry', false)).toBe('high');
  });

  it('tags the remaining seed subjects as low risk', () => {
    expect(deriveRiskTier('Use of English', false)).toBe('low');
    expect(deriveRiskTier('Biology', false)).toBe('low');
  });

  it('tags any item containing a calculation as high risk, whatever the subject', () => {
    // Plan 7.3: *every* item containing a calculation is high risk. A
    // Geography item that turns on arithmetic carries the same silent
    // wrong-key risk as a Mathematics one, and the subject alone misses it.
    expect(deriveRiskTier('Geography', true)).toBe('high');
    expect(deriveRiskTier('Economics', true)).toBe('high');
    expect(deriveRiskTier('Use of English', true)).toBe('high');
  });

  it('keeps a calculation-subject item high risk regardless of the flag', () => {
    expect(deriveRiskTier('Mathematics', true)).toBe('high');
  });
});
