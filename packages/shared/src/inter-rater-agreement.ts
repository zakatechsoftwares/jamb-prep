import type { ReviewAction } from './item-lifecycle';

/**
 * One item's two decisions — the first reviewer's and the second,
 * independent reviewer's, on an item that reached `needs_second_review`
 * (plan 7.10/7.11). `subjectId` travels with the pair so agreement can be
 * aggregated per subject without a second join at query time.
 */
export interface DecisionPair {
  subjectId: number;
  firstAction: ReviewAction;
  secondAction: ReviewAction;
}

export interface SubjectAgreement {
  subjectId: number;
  pairCount: number;
  agreementRate: number;
}

function normalizeAction(action: ReviewAction): 'approve' | 'reject' | 'escalate' {
  if (action === 'reject' || action === 'escalate') {
    return action;
  }
  return 'approve';
}

/**
 * Inter-rater agreement per subject (plan 7.11) — the one signal this
 * session adds beyond the plan's own list. Deliberately a **content**
 * signal, not a reviewer signal: persistently low agreement on a subject
 * means its items are ambiguous or its guidance is unclear, and should be
 * investigated there first, not read as which reviewers are wrong. Nothing
 * about this function's output identifies which reviewer was "right" — it
 * only ever reports whether two independent readings of the same item
 * matched.
 */
export function computeInterRaterAgreement(pairs: DecisionPair[]): SubjectAgreement[] {
  const bySubject = new Map<number, { agreeing: number; total: number }>();

  for (const pair of pairs) {
    const bucket = bySubject.get(pair.subjectId) ?? { agreeing: 0, total: 0 };
    bucket.total += 1;
    if (normalizeAction(pair.firstAction) === normalizeAction(pair.secondAction)) {
      bucket.agreeing += 1;
    }
    bySubject.set(pair.subjectId, bucket);
  }

  return Array.from(bySubject.entries()).map(([subjectId, { agreeing, total }]) => ({
    subjectId,
    pairCount: total,
    agreementRate: agreeing / total,
  }));
}
