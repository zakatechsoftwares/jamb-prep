import type { GeneratedRiskTier } from '@jamb/shared';

// Section 7.3: quantitative Mathematics, Physics and Chemistry are high risk
// as a category. Use of English and Biology (as seeded) are low risk.
const HIGH_RISK_SUBJECTS = new Set(['Mathematics', 'Physics', 'Chemistry']);

/**
 * The risk tier an item is generated at (7.3), from its subject and whether
 * it contains a calculation.
 *
 * A calculation makes an item high risk on its own, in any subject. This is
 * the plan's "single most important control": a language model asked for a
 * calculation item will occasionally produce an internally consistent
 * question with a wrong key, justified by a confident explanation. Subject
 * alone does not catch a Geography item that turns on arithmetic.
 *
 * Never returns 'not_generated'. That tier is not derived — it is assigned
 * by the commissioning workflow in 7.12 to the categories that are never
 * generated at all: diagram-dependent items, the recommended reading text,
 * and anything turning on current policy or office holders.
 */
export function deriveRiskTier(subject: string, containsCalculation: boolean): GeneratedRiskTier {
  if (containsCalculation) {
    return 'high';
  }

  return HIGH_RISK_SUBJECTS.has(subject) ? 'high' : 'low';
}
