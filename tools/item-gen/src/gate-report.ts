import type {
  GeneratedRiskTier,
  IndependentSolveVerdict,
  OptionLabel,
  SchemaValidationFailureReason,
} from '@jamb/shared';

/**
 * The gate report DONE WHEN asks for: what happened to every item the
 * authoring call produced, and why. `outcome` is the terminal fact for the
 * item; everything else is why it landed there.
 */
export type ItemGateOutcome =
  'auto_gated' | 'pending_review' | 'gate_failed' | 'discarded_before_insert';

export interface ItemGateResult {
  itemIndex: number;
  /** Null only for `discarded_before_insert` — a draft too malformed to become a row at all. */
  itemId: number | null;
  outcome: ItemGateOutcome;
  schemaFailures: SchemaValidationFailureReason[];
  duplicateOfItemId: number | null;
  duplicateSimilarity: number | null;
  independentSolveVerdict: IndependentSolveVerdict;
  riskTier: GeneratedRiskTier;
  sampledForReview: boolean;
  inferenceCostUsd: number | null;
}

export interface GateReport {
  objectiveId: number;
  subject: string;
  requestedCount: number;
  items: ItemGateResult[];
  keyDistributionBefore: Record<OptionLabel, number>;
  keyDistributionAfter: Record<OptionLabel, number>;
  totalAuthoringCostUsd: number;
  totalInferenceCostUsd: number;
}

export interface GateReportSummary {
  autoGated: number;
  pendingReview: number;
  gateFailed: number;
  discardedBeforeInsert: number;
}

export function summarizeGateReport(report: GateReport): GateReportSummary {
  const summary: GateReportSummary = {
    autoGated: 0,
    pendingReview: 0,
    gateFailed: 0,
    discardedBeforeInsert: 0,
  };

  for (const item of report.items) {
    switch (item.outcome) {
      case 'auto_gated':
        summary.autoGated += 1;
        break;
      case 'pending_review':
        summary.pendingReview += 1;
        break;
      case 'gate_failed':
        summary.gateFailed += 1;
        break;
      case 'discarded_before_insert':
        summary.discardedBeforeInsert += 1;
        break;
    }
  }

  return summary;
}

function formatDistribution(distribution: Record<OptionLabel, number>): string {
  return (['A', 'B', 'C', 'D'] as const)
    .map((label) => `${label}:${distribution[label]}`)
    .join(' ');
}

function formatItemLine(item: ItemGateResult): string {
  const idPart = item.itemId === null ? '(not inserted)' : `#${item.itemId}`;
  const reasons: string[] = [];
  if (item.schemaFailures.length > 0) {
    reasons.push(`schema: ${item.schemaFailures.join(', ')}`);
  }
  if (item.duplicateOfItemId !== null) {
    reasons.push(
      `duplicate of #${item.duplicateOfItemId} (similarity ${item.duplicateSimilarity?.toFixed(3) ?? '?'})`,
    );
  }
  if (item.independentSolveVerdict === 'disagreed') {
    reasons.push('independent solve disagreed');
  }
  if (item.riskTier === 'high') {
    reasons.push('high risk tier');
  }
  if (item.sampledForReview) {
    reasons.push('sampled for review');
  }
  const reasonText = reasons.length > 0 ? ` — ${reasons.join('; ')}` : '';
  const costText = item.inferenceCostUsd === null ? '' : ` [$${item.inferenceCostUsd.toFixed(4)}]`;

  return `  item ${item.itemIndex + 1} ${idPart}: ${item.outcome}${reasonText}${costText}`;
}

/** Human-readable gate report — DONE WHEN's "a gate report showing what was flagged and why". */
export function formatGateReport(report: GateReport): string {
  const summary = summarizeGateReport(report);
  const lines: string[] = [
    `Gate report — objective ${report.objectiveId} (${report.subject})`,
    `Requested ${report.requestedCount} items`,
    '',
    `Key distribution before rebalance: ${formatDistribution(report.keyDistributionBefore)}`,
    `Key distribution after rebalance:  ${formatDistribution(report.keyDistributionAfter)}`,
    '',
    ...report.items.map(formatItemLine),
    '',
    `Summary: ${summary.autoGated} auto-gated, ${summary.pendingReview} to human review, ${summary.gateFailed} gate-failed, ${summary.discardedBeforeInsert} discarded before insert`,
    `Cost: $${report.totalAuthoringCostUsd.toFixed(4)} authoring + solve calls, $${report.totalInferenceCostUsd.toFixed(4)} total recorded on inserted items`,
  ];

  return lines.join('\n');
}
