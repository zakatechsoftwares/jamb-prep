/**
 * Cost accounting for the item-generation pipeline (item-generation-spec.md
 * §1, plan 7.4/7.11) — pure arithmetic, no I/O. `tools/item-gen` supplies
 * real token counts from the Anthropic API's response; `packages/db` writes
 * the result to `items.inference_cost_usd`, which is what the content-lead
 * dashboard's `costPerApprovedItem` (session 09) reads.
 */

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ModelPricing {
  inputCostPerMillionUsd: number;
  outputCostPerMillionUsd: number;
}

/**
 * List pricing, USD per million tokens. There is no live pricing API to
 * query, so this table is a maintained constant — verify it against
 * Anthropic's current published pricing before relying on it for a real
 * budget figure, and update it here (not by computing a fudge factor
 * elsewhere) whenever pricing changes.
 */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-sonnet-5': { inputCostPerMillionUsd: 3, outputCostPerMillionUsd: 15 },
  'claude-haiku-4-5-20251001': { inputCostPerMillionUsd: 1, outputCostPerMillionUsd: 5 },
};

export function computeCallCostUsd(model: string, usage: TokenUsage): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) {
    throw new Error(
      `computeCallCostUsd: no pricing configured for model '${model}' — add it to MODEL_PRICING`,
    );
  }
  if (usage.inputTokens < 0 || usage.outputTokens < 0) {
    throw new Error('computeCallCostUsd: token counts must be non-negative');
  }

  return (
    (usage.inputTokens / 1_000_000) * pricing.inputCostPerMillionUsd +
    (usage.outputTokens / 1_000_000) * pricing.outputCostPerMillionUsd
  );
}

/**
 * DECISION, not a default: one authoring call's cost is divided across
 * every item that ended up as a real row from it — both a gate_failed item
 * and a gate-passed one count, since both got a row; only a draft too
 * malformed to insert at all is excluded, and its share is NOT written off
 * elsewhere. It is redistributed onto the items that DID survive.
 *
 * This is what makes `costPerApprovedItem` on the content-lead dashboard
 * (session 09) an honest number. If a failed item's share were quietly
 * excluded instead, a batch with a 50% malformed-draft rate would show
 * exactly the same average `inference_cost_usd` as a clean batch — hiding
 * precisely the signal a content lead needs ("this objective is generating
 * badly and burning budget"). So: full call cost divided by the actual
 * inserted count, always. Cost per surviving item goes UP when a batch
 * produces more waste, which is the honest answer to "what did each usable
 * item actually cost," even though it means two batches that produced the
 * same 7 good items can show different `inference_cost_usd` per item
 * depending on how much waste came with them.
 *
 * A batch with zero inserted items (the authoring call produced nothing
 * insertable at all) has no item to attribute cost to — the caller must
 * handle that case itself (log the loss; this function refuses to divide
 * by zero rather than silently returning Infinity or NaN).
 */
export function apportionAuthoringCost(
  authoringCallCostUsd: number,
  insertedItemCount: number,
): number {
  if (authoringCallCostUsd < 0) {
    throw new Error('apportionAuthoringCost: authoringCallCostUsd must be non-negative');
  }
  if (!Number.isInteger(insertedItemCount) || insertedItemCount <= 0) {
    throw new Error(
      'apportionAuthoringCost: insertedItemCount must be a positive integer — a fully-failed batch (zero inserted items) must be handled by the caller, not divided here',
    );
  }

  return authoringCallCostUsd / insertedItemCount;
}

export function computeItemInferenceCostUsd(
  authoringCostShareUsd: number,
  solveCallCostUsd: number,
): number {
  if (authoringCostShareUsd < 0 || solveCallCostUsd < 0) {
    throw new Error('computeItemInferenceCostUsd: both components must be non-negative');
  }

  return authoringCostShareUsd + solveCallCostUsd;
}
