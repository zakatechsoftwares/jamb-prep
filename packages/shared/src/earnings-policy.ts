import type { RiskTier } from './item-lifecycle';

/**
 * Reviewer payment rates (plan 7.11), versioned like `review_queue_configs`
 * — an operating decision that changes between generation waves, not a
 * release. Amounts are in kobo (NGN's smallest unit), matching
 * `transactions.amount_kobo`.
 */
export interface PaymentRateConfig {
  baseRateKobo: number;
  /** Additional pay for a `risk_tier = 'high'` (calculation) item. */
  highTierBonusKobo: number;
  /** Additional pay when this decision resolves `needs_second_review`. */
  secondReviewBonusKobo: number;
}

export interface EarningsInput {
  riskTier: RiskTier;
  isSecondReview: boolean;
}

function assertNonNegativeWholeKobo(value: number, fieldName: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`computeEarningsKobo: ${fieldName} must be a non-negative whole number of kobo, got ${value}`);
  }
}

/**
 * Computes a decision's earnings (plan 7.11). Deliberately takes no
 * `action` parameter: approve, reject, escalate and edit_and_approve all
 * pay identically. Paying a rejection less than an approval is the exact
 * structural incentive to wave items through that this design refuses —
 * "do not optimise it later" is explicit in the plan, and the omission
 * here is how that stays true by construction rather than by convention a
 * future caller could accidentally violate.
 *
 * The two bonuses are independent and stack: a high-tier item's second
 * review earns both.
 */
export function computeEarningsKobo(config: PaymentRateConfig, input: EarningsInput): number {
  assertNonNegativeWholeKobo(config.baseRateKobo, 'baseRateKobo');
  assertNonNegativeWholeKobo(config.highTierBonusKobo, 'highTierBonusKobo');
  assertNonNegativeWholeKobo(config.secondReviewBonusKobo, 'secondReviewBonusKobo');

  let total = config.baseRateKobo;
  if (input.riskTier === 'high') {
    total += config.highTierBonusKobo;
  }
  if (input.isSecondReview) {
    total += config.secondReviewBonusKobo;
  }
  return total;
}
