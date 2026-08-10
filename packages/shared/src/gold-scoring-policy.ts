import type { OptionLabel, ReviewAction } from './item-lifecycle';

/**
 * A gold item's known-correct answer (plan 7.11), as read from `gold_items`.
 * `referenceKey` is the item's actual correct option — for a clean gold item
 * it is simply what the key already is; for one with a planted wrong key it
 * is what the key ought to be corrected to.
 */
export interface GoldReference {
  referenceDecision: 'approve' | 'reject' | 'escalate';
  referenceKey: OptionLabel;
}

/** What the reviewer actually did, in the shape `scoresAgreement` needs. */
export interface GoldScoringInput {
  action: ReviewAction;
  /** Present only when `action` is `edit_and_approve` and the key was part of the edit. */
  editedKey?: OptionLabel;
}

function normalizeAction(action: ReviewAction): 'approve' | 'reject' | 'escalate' {
  if (action === 'reject' || action === 'escalate') {
    return action;
  }
  return 'approve';
}

/**
 * Whether the reviewer's decision agrees with a gold item's reference
 * (plan 7.11) — the continuous, silent accuracy signal. `edit_and_approve`
 * counts as an approval for this comparison; a gold item whose reference is
 * `'reject'` is never satisfied by editing it into shape, since a planted
 * defect gold item measures whether the reviewer recognises it as
 * rejectable, not whether they could theoretically repair it.
 *
 * When the reference is `'approve'` and the reviewer both approved and
 * supplied a corrected key, the correction itself is graded too: approving
 * while leaving (or introducing) the wrong key is a real disagreement, even
 * though the top-level action matches.
 */
export function scoresAgreement(reference: GoldReference, actual: GoldScoringInput): boolean {
  const normalized = normalizeAction(actual.action);
  if (normalized !== reference.referenceDecision) {
    return false;
  }

  if (
    reference.referenceDecision === 'approve' &&
    actual.action === 'edit_and_approve' &&
    actual.editedKey !== undefined
  ) {
    return actual.editedKey === reference.referenceKey;
  }

  return true;
}
