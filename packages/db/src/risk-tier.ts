// Section 7.3: quantitative Mathematics/Physics/Chemistry are high risk;
// Use of English and Biology (as seeded) are low risk.
const HIGH_RISK_SUBJECTS = new Set(['Mathematics', 'Physics', 'Chemistry']);

export type RiskTier = 'low' | 'high';

export function deriveRiskTier(subject: string): RiskTier {
  return HIGH_RISK_SUBJECTS.has(subject) ? 'high' : 'low';
}
