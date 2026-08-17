import { BRIEF_STATUSES, type BriefStatus } from './brief-lifecycle';

/** A brief may only be claimed while it's still open. */
export function isBriefClaimable(status: BriefStatus): boolean {
  if (!(BRIEF_STATUSES as readonly string[]).includes(status)) {
    throw new Error(`isBriefClaimable: unrecognized status '${status}'`);
  }
  return status === 'open';
}

/**
 * Splits a brief's flat fee across its items, paid one item at a time as
 * each is approved (not held until the whole brief completes — plan 7.12
 * lists the fee as a single amount per brief, but this repo's earnings are
 * already per-decision, and there's no reason to invent brief-completion
 * tracking just for payment timing).
 *
 * DECISION: `feeKobo` is an integer and does not always divide evenly by
 * `itemCount` — the remainder goes to whichever item is paid *last*
 * (`alreadyPaidCount === itemCount - 1`), so the sum paid across every item
 * in a brief always equals the full fee exactly. Silently flooring every
 * item's share would quietly lose the remainder to rounding; this is money,
 * not a cost estimate, so nothing here may be lost or overpaid.
 *
 * `alreadyPaidCount` is how many of this brief's items have already had a
 * fee recorded — the caller (packages/db) knows this by counting existing
 * `reviewer_earnings` rows for the brief, since items can be approved out
 * of submission order.
 */
export function apportionBriefFeeKobo(feeKobo: number, itemCount: number, alreadyPaidCount: number): number {
  if (!Number.isInteger(feeKobo) || feeKobo < 0) {
    throw new Error(`apportionBriefFeeKobo: feeKobo must be a non-negative whole number, got ${feeKobo}`);
  }
  if (!Number.isInteger(itemCount) || itemCount <= 0) {
    throw new Error(`apportionBriefFeeKobo: itemCount must be a positive whole number, got ${itemCount}`);
  }
  if (!Number.isInteger(alreadyPaidCount) || alreadyPaidCount < 0) {
    throw new Error(
      `apportionBriefFeeKobo: alreadyPaidCount must be a non-negative whole number, got ${alreadyPaidCount}`,
    );
  }
  if (alreadyPaidCount >= itemCount) {
    throw new Error(
      `apportionBriefFeeKobo: alreadyPaidCount (${alreadyPaidCount}) must be less than itemCount (${itemCount}) — this brief is already fully paid`,
    );
  }

  const perItem = Math.floor(feeKobo / itemCount);
  const isLastItem = alreadyPaidCount === itemCount - 1;
  return isLastItem ? feeKobo - perItem * (itemCount - 1) : perItem;
}
