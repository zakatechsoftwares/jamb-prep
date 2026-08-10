import { describe, expect, it } from 'vitest';
import { computeEarningsKobo, type PaymentRateConfig } from './earnings-policy';

const CONFIG: PaymentRateConfig = {
  baseRateKobo: 5000,
  highTierBonusKobo: 3000,
  secondReviewBonusKobo: 2000,
};

describe('computeEarningsKobo', () => {
  it('pays the base rate for an ordinary low-tier, first-review decision', () => {
    expect(computeEarningsKobo(CONFIG, { riskTier: 'low', isSecondReview: false })).toBe(5000);
  });

  it('adds the high-tier bonus for a calculation item', () => {
    expect(computeEarningsKobo(CONFIG, { riskTier: 'high', isSecondReview: false })).toBe(8000);
  });

  it('adds the second-review bonus when the decision resolves needs_second_review', () => {
    expect(computeEarningsKobo(CONFIG, { riskTier: 'low', isSecondReview: true })).toBe(7000);
  });

  it('stacks both bonuses for a high-tier item decided as the second review', () => {
    expect(computeEarningsKobo(CONFIG, { riskTier: 'high', isSecondReview: true })).toBe(10000);
  });

  it('pays a not_generated item the base rate, same as low — only high_tier carries a bonus', () => {
    expect(computeEarningsKobo(CONFIG, { riskTier: 'not_generated', isSecondReview: false })).toBe(
      5000,
    );
  });

  it('throws on a negative base rate rather than silently paying nothing', () => {
    const bad: PaymentRateConfig = { ...CONFIG, baseRateKobo: -1 };
    expect(() => computeEarningsKobo(bad, { riskTier: 'low', isSecondReview: false })).toThrow(
      /baseRateKobo/,
    );
  });

  it('throws on a negative high-tier bonus', () => {
    const bad: PaymentRateConfig = { ...CONFIG, highTierBonusKobo: -1 };
    expect(() => computeEarningsKobo(bad, { riskTier: 'high', isSecondReview: false })).toThrow(
      /highTierBonusKobo/,
    );
  });

  it('throws on a negative second-review bonus', () => {
    const bad: PaymentRateConfig = { ...CONFIG, secondReviewBonusKobo: -1 };
    expect(() => computeEarningsKobo(bad, { riskTier: 'low', isSecondReview: true })).toThrow(
      /secondReviewBonusKobo/,
    );
  });

  it('throws when baseRateKobo is not a whole number — kobo is the smallest unit', () => {
    const bad: PaymentRateConfig = { ...CONFIG, baseRateKobo: 5000.5 };
    expect(() => computeEarningsKobo(bad, { riskTier: 'low', isSecondReview: false })).toThrow(
      /baseRateKobo/,
    );
  });
});
