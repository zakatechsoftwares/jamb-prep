import type { PoolClient } from 'pg';
import { computeEarningsKobo, type PaymentRateConfig, type RiskTier } from '@jamb/shared';

/**
 * Records a decision's earnings (plan 7.11), frozen against whichever
 * payment rate config is active right now — never recomputed later against
 * a config that may since have changed. Called from `decideOnItem`'s own
 * transaction for both a `'live'` and a `'late_arrival'` decision (a
 * late-arriving second opinion is still real reviewer work), and is never
 * clawed back even if the reviewer is later deactivated for sustained low
 * accuracy — see `deactivateForSustainedFailure` in
 * `reviewer-quality-repository.ts`.
 *
 * `isSecondReview` should be `false` for a late-arrival decision: nothing
 * about a late arrival ever actually resolves `needs_second_review` (no
 * transition happens for it at all — see `decideOnItem`), so it never
 * served as the operative second review, whatever the item's status.
 */
export async function recordEarning(
  client: PoolClient,
  reviewDecisionId: number,
  reviewerId: number,
  riskTier: RiskTier,
  isSecondReview: boolean,
): Promise<void> {
  const configRow = (
    await client.query<{
      version: number;
      base_rate_kobo: string;
      high_tier_bonus_kobo: string;
      second_review_bonus_kobo: string;
    }>(
      `SELECT version, base_rate_kobo, high_tier_bonus_kobo, second_review_bonus_kobo
         FROM payment_rate_configs WHERE active`,
    )
  ).rows[0];

  if (!configRow) {
    throw new Error('recordEarning: no payment_rate_configs row is currently active');
  }

  const config: PaymentRateConfig = {
    baseRateKobo: Number(configRow.base_rate_kobo),
    highTierBonusKobo: Number(configRow.high_tier_bonus_kobo),
    secondReviewBonusKobo: Number(configRow.second_review_bonus_kobo),
  };

  const amountKobo = computeEarningsKobo(config, { riskTier, isSecondReview });

  const rateBasis = {
    configVersion: configRow.version,
    riskTier,
    isSecondReview,
  };

  await client.query(
    `INSERT INTO reviewer_earnings (review_decision_id, reviewer_id, amount_kobo, rate_basis)
     VALUES ($1, $2, $3, $4)`,
    [reviewDecisionId, reviewerId, amountKobo, JSON.stringify(rateBasis)],
  );
}
