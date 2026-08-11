import { describe, expect, it } from 'vitest';
import {
  apportionAuthoringCost,
  computeCallCostUsd,
  computeItemInferenceCostUsd,
  MODEL_PRICING,
} from './item-gen-cost';

describe('computeCallCostUsd', () => {
  it('computes cost from input/output token counts at the configured rate', () => {
    const [model, pricing] = Object.entries(MODEL_PRICING)[0]!;
    const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000 };
    expect(computeCallCostUsd(model, usage)).toBeCloseTo(
      pricing.inputCostPerMillionUsd + pricing.outputCostPerMillionUsd,
      6,
    );
  });

  it('scales linearly with token count', () => {
    const [model] = Object.entries(MODEL_PRICING)[0]!;
    const full = computeCallCostUsd(model, { inputTokens: 1_000_000, outputTokens: 0 });
    const half = computeCallCostUsd(model, { inputTokens: 500_000, outputTokens: 0 });
    expect(half).toBeCloseTo(full / 2, 6);
  });

  it('throws for a model with no configured pricing', () => {
    expect(() =>
      computeCallCostUsd('not-a-real-model', { inputTokens: 1, outputTokens: 1 }),
    ).toThrow(/pricing/i);
  });

  it('throws for negative token counts', () => {
    const [model] = Object.entries(MODEL_PRICING)[0]!;
    expect(() => computeCallCostUsd(model, { inputTokens: -1, outputTokens: 0 })).toThrow(
      /non-negative/i,
    );
  });
});

describe('apportionAuthoringCost', () => {
  it('divides the call cost evenly across the items actually inserted', () => {
    expect(apportionAuthoringCost(1.4, 7)).toBeCloseTo(0.2, 6);
  });

  it('DECISION: apportions across the inserted count, not the requested count — a batch that authored 10 items but only 7 survived to insertion still divides by 7, so the full spend is accounted for on the survivors rather than silently written off', () => {
    const requestedCount = 10;
    const insertedCount = 7;
    const totalCost = 1.4;

    const perItemAgainstInserted = apportionAuthoringCost(totalCost, insertedCount);
    const perItemAgainstRequestedWouldHaveBeen = totalCost / requestedCount;

    expect(perItemAgainstInserted).toBeGreaterThan(perItemAgainstRequestedWouldHaveBeen);
    expect(perItemAgainstInserted * insertedCount).toBeCloseTo(totalCost, 6);
  });

  it('throws when there are zero inserted items — the caller must handle a fully-failed batch itself', () => {
    expect(() => apportionAuthoringCost(1.4, 0)).toThrow(/positive/i);
  });

  it('throws for a negative cost', () => {
    expect(() => apportionAuthoringCost(-1, 5)).toThrow(/non-negative/i);
  });
});

describe('computeItemInferenceCostUsd', () => {
  it("sums the apportioned authoring share and the item's own solve-call cost", () => {
    expect(computeItemInferenceCostUsd(0.02, 0.005)).toBeCloseTo(0.025, 6);
  });

  it('throws for a negative component', () => {
    expect(() => computeItemInferenceCostUsd(-0.01, 0.005)).toThrow(/non-negative/i);
    expect(() => computeItemInferenceCostUsd(0.01, -0.005)).toThrow(/non-negative/i);
  });
});
