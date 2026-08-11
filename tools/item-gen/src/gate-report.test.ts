import { describe, expect, it } from 'vitest';
import {
  formatGateReport,
  summarizeGateReport,
  type GateReport,
  type ItemGateResult,
} from './gate-report';

function item(overrides: Partial<ItemGateResult>): ItemGateResult {
  return {
    itemIndex: 0,
    itemId: 1,
    outcome: 'auto_gated',
    schemaFailures: [],
    duplicateOfItemId: null,
    duplicateSimilarity: null,
    independentSolveVerdict: 'agreed',
    riskTier: 'low',
    sampledForReview: false,
    inferenceCostUsd: 0.01,
    ...overrides,
  };
}

function report(items: ItemGateResult[]): GateReport {
  return {
    objectiveId: 42,
    subject: 'Chemistry',
    requestedCount: items.length,
    items,
    keyDistributionBefore: { A: 4, B: 0, C: 0, D: 0 },
    keyDistributionAfter: { A: 1, B: 1, C: 1, D: 1 },
    totalAuthoringCostUsd: 0.04,
    totalInferenceCostUsd: 0.05,
  };
}

describe('summarizeGateReport', () => {
  it('counts each outcome', () => {
    const summary = summarizeGateReport(
      report([
        item({ itemIndex: 0, outcome: 'auto_gated' }),
        item({ itemIndex: 1, outcome: 'pending_review' }),
        item({ itemIndex: 2, outcome: 'gate_failed', itemId: 3 }),
        item({ itemIndex: 3, outcome: 'discarded_before_insert', itemId: null }),
        item({ itemIndex: 4, outcome: 'auto_gated' }),
      ]),
    );

    expect(summary).toEqual({
      autoGated: 2,
      pendingReview: 1,
      gateFailed: 1,
      discardedBeforeInsert: 1,
    });
  });

  it('returns all zeros for an empty batch', () => {
    expect(summarizeGateReport(report([]))).toEqual({
      autoGated: 0,
      pendingReview: 0,
      gateFailed: 0,
      discardedBeforeInsert: 0,
    });
  });
});

describe('formatGateReport', () => {
  it('includes the objective, key distribution, per-item outcomes and reasons, and the summary line', () => {
    const text = formatGateReport(
      report([
        item({
          itemIndex: 0,
          outcome: 'gate_failed',
          itemId: 2,
          schemaFailures: ['missing_distractor_rationale'],
        }),
        item({
          itemIndex: 1,
          outcome: 'gate_failed',
          itemId: 3,
          duplicateOfItemId: 99,
          duplicateSimilarity: 0.95,
          schemaFailures: [],
        }),
        item({ itemIndex: 2, outcome: 'pending_review', riskTier: 'high' }),
        item({ itemIndex: 3, outcome: 'auto_gated' }),
      ]),
    );

    expect(text).toContain('objective 42 (Chemistry)');
    expect(text).toContain('Key distribution before rebalance: A:4 B:0 C:0 D:0');
    expect(text).toContain('Key distribution after rebalance:  A:1 B:1 C:1 D:1');
    expect(text).toContain('missing_distractor_rationale');
    expect(text).toContain('duplicate of #99 (similarity 0.950)');
    expect(text).toContain('high risk tier');
    expect(text).toContain(
      'Summary: 1 auto-gated, 1 to human review, 2 gate-failed, 0 discarded before insert',
    );
  });

  it('shows "(not inserted)" for a discarded-before-insert item', () => {
    const text = formatGateReport(
      report([
        item({
          itemIndex: 0,
          outcome: 'discarded_before_insert',
          itemId: null,
          inferenceCostUsd: null,
        }),
      ]),
    );
    expect(text).toContain('(not inserted)');
  });
});
