import { describe, expect, it } from 'vitest';
import { apportionBriefFeeKobo, isBriefClaimable } from './brief-policy';

describe('isBriefClaimable', () => {
  it('is claimable when open', () => {
    expect(isBriefClaimable('open')).toBe(true);
  });

  it('is not claimable once claimed', () => {
    expect(isBriefClaimable('claimed')).toBe(false);
  });

  it('is not claimable once completed', () => {
    expect(isBriefClaimable('completed')).toBe(false);
  });

  it('throws for an unrecognized status', () => {
    // @ts-expect-error deliberately passing a value outside BriefStatus
    expect(() => isBriefClaimable('cancelled')).toThrow(/status/);
  });
});

describe('apportionBriefFeeKobo', () => {
  it('divides an evenly-divisible fee equally across every item', () => {
    expect(apportionBriefFeeKobo(1000, 5, 0)).toBe(200);
    expect(apportionBriefFeeKobo(1000, 5, 4)).toBe(200);
  });

  it('DECISION: the remainder of an unevenly-divisible fee goes to the last item paid, so the sum across every item always equals the full fee exactly — never lost or overpaid to rounding', () => {
    expect(apportionBriefFeeKobo(1000, 3, 0)).toBe(333);
    expect(apportionBriefFeeKobo(1000, 3, 1)).toBe(333);
    expect(apportionBriefFeeKobo(1000, 3, 2)).toBe(334);

    const total =
      apportionBriefFeeKobo(1000, 3, 0) + apportionBriefFeeKobo(1000, 3, 1) + apportionBriefFeeKobo(1000, 3, 2);
    expect(total).toBe(1000);
  });

  it('pays the full fee to a single-item brief', () => {
    expect(apportionBriefFeeKobo(500, 1, 0)).toBe(500);
  });

  it('a zero fee apportions to zero for every item, including the last', () => {
    expect(apportionBriefFeeKobo(0, 3, 0)).toBe(0);
    expect(apportionBriefFeeKobo(0, 3, 2)).toBe(0);
  });

  it('throws for a negative fee', () => {
    expect(() => apportionBriefFeeKobo(-1, 3, 0)).toThrow(/feeKobo/);
  });

  it('throws when itemCount is not a positive integer', () => {
    expect(() => apportionBriefFeeKobo(1000, 0, 0)).toThrow(/itemCount/);
    expect(() => apportionBriefFeeKobo(1000, -1, 0)).toThrow(/itemCount/);
    expect(() => apportionBriefFeeKobo(1000, 2.5, 0)).toThrow(/itemCount/);
  });

  it('throws when alreadyPaidCount is negative', () => {
    expect(() => apportionBriefFeeKobo(1000, 3, -1)).toThrow(/alreadyPaidCount/);
  });

  it('throws when alreadyPaidCount is not less than itemCount — the brief is already fully paid, a caller bug', () => {
    expect(() => apportionBriefFeeKobo(1000, 3, 3)).toThrow(/alreadyPaidCount/);
    expect(() => apportionBriefFeeKobo(1000, 3, 4)).toThrow(/alreadyPaidCount/);
  });
});
