import type { PoolClient } from 'pg';
import {
  computeCallCostUsd,
  computeItemInferenceCostUsd,
  apportionAuthoringCost,
  cosineSimilarity,
  permuteToRebalance,
  qualifiesForAutomatedRoute,
  resolveContainsCalculation,
  shouldSampleForReview,
  validateItemSchema,
  type GeneratedRiskTier,
  type IndependentSolveVerdict,
  type ItemDraft,
  type ItemFacts,
  type LifecycleEvent,
  type ReviewQueueConfig,
} from '@jamb/shared';
import {
  deriveRiskTier,
  insertGeneratedItem,
  loadActiveQueueConfig,
  loadLiveBankEmbeddings,
  loadObjectiveContext,
  promoteGeneratedItem,
  type EmbeddingCandidate,
  type GeneratedItemInsert,
  type ObjectiveContext,
} from '@jamb/db';
import { callCodexCli, isRetryableCodexCliError } from './codex-cli-client';
import { callClaudeCli, isRetryableClaudeCliError } from './claude-cli-client';
import type { RunCliImpl } from './cli-exec';
import type { LocalEmbedder } from './local-embedding-client';
import { withRetry } from './retry';
import { buildAuthoringPrompt, type DifficultyTarget } from './authoring-prompt';
import { buildIndependentSolvePrompt, toIndependentSolveInput } from './independent-solve-prompt';
import { parseAuthoringResponse, parseSolveResponse } from './parse-authoring-response';
import { logRawResponse } from './raw-response-logger';
import type { GateReport, ItemGateResult } from './gate-report';

/**
 * The item-generation pipeline's orchestration core (item-generation-spec.md,
 * plan 7.4). Every external effect — HTTP, the clock, randomness, sleep —
 * is injected via `RunGenerationDependencies`, so this is fully testable
 * against a fake HTTP layer and a real (test) Postgres database, with no
 * real API key required. `cli.ts` is the only caller that wires real
 * dependencies.
 *
 * Duplicate detection compares an item's embedding against the live bank
 * AND every item already inserted earlier in this same batch, tracked
 * in-memory as processing proceeds. Concurrent workers (see
 * `CONCURRENCY_LIMIT`) can race on that in-memory list — two similar items
 * processed in parallel might neither see the other as "already inserted."
 * Accepted, not engineered around: a batch is ten items, the race window
 * is one embedding-and-insert round trip, and a duplicate that slips
 * through here is still caught eventually — by a later run's duplicate
 * check once the first is genuinely live, or by human review.
 */

const DUPLICATE_SIMILARITY_THRESHOLD = 0.92;
const CONCURRENCY_LIMIT = 3;
const RETRY_OPTIONS_BASE = { maxAttempts: 4, initialDelayMs: 1000 };
const AUTHORING_PROMPT_VERSION = 1;

/**
 * Fixed pricing keys for `item-gen-cost.ts`'s `MODEL_PRICING`, never the
 * real underlying model name either CLI happens to pick -- both are
 * pinned to $0 there (subscription calls, no per-token billing), and
 * pinning the lookup key to the CLI itself rather than its model keeps
 * that true regardless of which model each CLI's own defaults select.
 */
const CODEX_CLI_PRICING_KEY = 'codex-cli';
const CLAUDE_CLI_PRICING_KEY = 'claude-code-cli';

export interface RunGenerationOptions {
  subject: string;
  objectiveId: number;
  count: number;
  difficultyTarget: DifficultyTarget;
  cognitiveLevel: string;
}

export interface RunGenerationDependencies {
  readClient: PoolClient;
  withTransaction: <T>(fn: (client: PoolClient) => Promise<T>) => Promise<T>;
  runCli: RunCliImpl;
  /** Optional override; omitted lets each CLI use its own default model. */
  codexModel?: string;
  claudeModel?: string;
  /** Path to an already-written JSON Schema file for the authoring call's `--output-schema` (see `authoring-schema.ts`). Writing it is the caller's job. */
  authoringOutputSchemaPath: string;
  embedder: LocalEmbedder;
  random: () => number;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
  logDir: string;
}

async function runWithConcurrencyLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) {
        return;
      }
      results[index] = await fn(items[index] as T, index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

interface BatchState {
  authoringCostSharePerItem: number;
  authoringLogPath: string;
  queueConfig: ReviewQueueConfig;
  liveBank: EmbeddingCandidate[];
  /** Items inserted so far this batch — mutated as processing proceeds. */
  batchEmbeddings: EmbeddingCandidate[];
  /** Running total across the batch — mutated as processing proceeds. See `GateReport.legacyEmbeddingsSkipped`'s own doc comment. */
  legacyEmbeddingsSkipped: number;
}

export async function runGeneration(
  options: RunGenerationOptions,
  deps: RunGenerationDependencies,
): Promise<GateReport> {
  const context = await loadObjectiveContext(deps.readClient, options.objectiveId);
  if (context.subjectName.toLowerCase() !== options.subject.toLowerCase()) {
    throw new Error(
      `runGeneration: objective ${options.objectiveId} belongs to subject '${context.subjectName}', not '${options.subject}' — check --objective-id`,
    );
  }

  const authoringPrompt = buildAuthoringPrompt({
    subject: context.subjectName,
    topic: context.topicName,
    subtopic: context.subtopicName,
    objectiveText: context.objectiveDescription,
    difficultyTarget: options.difficultyTarget,
    cognitiveLevel: options.cognitiveLevel,
    count: options.count,
  });

  const authoringResult = await withRetry(
    () =>
      callCodexCli(deps.runCli, {
        prompt: authoringPrompt,
        model: deps.codexModel,
        outputSchemaPath: deps.authoringOutputSchemaPath,
      }),
    { ...RETRY_OPTIONS_BASE, sleep: deps.sleep, isRetryable: isRetryableCodexCliError },
  );

  const authoringLogPath = await logRawResponse(deps.logDir, {
    callType: 'authoring',
    objectiveId: options.objectiveId,
    timestamp: deps.now(),
    rawResponse: authoringResult.rawResponse,
  });

  const authoringCostUsd = computeCallCostUsd(CODEX_CLI_PRICING_KEY, authoringResult.usage);
  const { drafts, discardedCount } = parseAuthoringResponse(authoringResult.text);

  const discardedResults: ItemGateResult[] = Array.from(
    { length: discardedCount },
    (_unused, i) => ({
      itemIndex: drafts.length + i,
      itemId: null,
      outcome: 'discarded_before_insert',
      schemaFailures: [],
      duplicateOfItemId: null,
      duplicateSimilarity: null,
      independentSolveVerdict: 'not_run',
      riskTier: 'low',
      sampledForReview: false,
      inferenceCostUsd: null,
    }),
  );

  if (drafts.length === 0) {
    // Nothing survived to insert — the whole authoring spend is
    // unattributable to any item (apportionAuthoringCost refuses to divide
    // by zero on purpose; this is the caller handling that case, as its
    // own doc comment requires).
    return {
      objectiveId: options.objectiveId,
      subject: context.subjectName,
      requestedCount: options.count,
      items: discardedResults,
      keyDistributionBefore: { A: 0, B: 0, C: 0, D: 0 },
      keyDistributionAfter: { A: 0, B: 0, C: 0, D: 0 },
      totalAuthoringCostUsd: authoringCostUsd,
      totalInferenceCostUsd: 0,
      legacyEmbeddingsSkipped: 0,
    };
  }

  const rebalance = permuteToRebalance(drafts, deps.random);
  const authoringCostSharePerItem = apportionAuthoringCost(authoringCostUsd, drafts.length);
  const queueConfig = await loadActiveQueueConfig(deps.readClient);
  const liveBank = await loadLiveBankEmbeddings(deps.readClient, context.subjectId);

  const batchState: BatchState = {
    authoringCostSharePerItem,
    authoringLogPath,
    queueConfig,
    liveBank,
    batchEmbeddings: [],
    legacyEmbeddingsSkipped: 0,
  };

  const itemResults = await runWithConcurrencyLimit(
    rebalance.items,
    CONCURRENCY_LIMIT,
    (draft, index) => processOneItem(draft, index, context, options, deps, batchState),
  );

  const totalInferenceCostUsd = itemResults.reduce(
    (sum, item) => sum + (item.inferenceCostUsd ?? 0),
    0,
  );

  return {
    objectiveId: options.objectiveId,
    subject: context.subjectName,
    requestedCount: options.count,
    items: [...itemResults, ...discardedResults],
    keyDistributionBefore: rebalance.distributionBefore,
    keyDistributionAfter: rebalance.distributionAfter,
    totalAuthoringCostUsd: authoringCostUsd,
    totalInferenceCostUsd,
    legacyEmbeddingsSkipped: batchState.legacyEmbeddingsSkipped,
  };
}

async function processOneItem(
  draft: ItemDraft,
  index: number,
  context: ObjectiveContext,
  options: RunGenerationOptions,
  deps: RunGenerationDependencies,
  batch: BatchState,
): Promise<ItemGateResult> {
  const optionTexts = draft.options.map((option) => option.text);
  const containsCalculation = resolveContainsCalculation(
    draft.modelReportedContainsCalculation,
    draft.stem,
    optionTexts,
  );
  const riskTier: GeneratedRiskTier = deriveRiskTier(context.subjectName, containsCalculation);

  const buildInsert = (
    verdict: IndependentSolveVerdict,
    sampledForReview: boolean,
    stemEmbedding: number[] | null,
    inferenceCostUsd: number,
  ): GeneratedItemInsert => ({
    subjectId: context.subjectId,
    topicId: context.topicId,
    subtopicId: context.subtopicId,
    objectiveId: context.objectiveId,
    stem: draft.stem,
    explanation: draft.explanation,
    methodSteps: draft.methodSteps,
    cognitiveLevel: draft.cognitiveLevel,
    authorDifficulty: draft.authorDifficulty,
    expectedTimeSeconds: draft.expectedTimeSeconds,
    riskTier,
    independentSolveVerdict: verdict,
    sampledForReview,
    stemEmbedding,
    inferenceCostUsd,
    provenance: {
      model: CODEX_CLI_PRICING_KEY,
      codexModel: deps.codexModel ?? null,
      promptVersion: AUTHORING_PROMPT_VERSION,
      generatedAt: deps.now().toISOString(),
      rawResponseLogPath: batch.authoringLogPath,
    },
    options: draft.options,
    contributorId: null,
    briefId: null,
  });

  const insertAndPromote = async (
    verdict: IndependentSolveVerdict,
    sampledForReview: boolean,
    stemEmbedding: number[] | null,
    inferenceCostUsd: number,
    event: LifecycleEvent,
  ): Promise<number> => {
    const itemFacts: ItemFacts = {
      contributorUserId: null,
      riskTier,
      independentSolveVerdict: verdict,
      sampledForReview,
    };
    return deps.withTransaction(async (client) => {
      const itemId = await insertGeneratedItem(
        client,
        buildInsert(verdict, sampledForReview, stemEmbedding, inferenceCostUsd),
      );
      await promoteGeneratedItem(client, itemId, itemFacts, event, deps.now());
      return itemId;
    });
  };

  const schemaResult = validateItemSchema(draft);
  if (!schemaResult.ok) {
    const itemId = await insertAndPromote('not_run', false, null, batch.authoringCostSharePerItem, {
      type: 'gates_failed',
    });
    return {
      itemIndex: index,
      itemId,
      outcome: 'gate_failed',
      schemaFailures: schemaResult.failures,
      duplicateOfItemId: null,
      duplicateSimilarity: null,
      independentSolveVerdict: 'not_run',
      riskTier,
      sampledForReview: false,
      inferenceCostUsd: batch.authoringCostSharePerItem,
    };
  }

  // Computed locally (ONNX, no network, no API response) -- no retry
  // wrapper and no raw-response audit log, since there is no external
  // call whose response varies run to run to audit; the same text always
  // produces the same vector.
  const embedding = (await deps.embedder.embed([draft.stem]))[0] ?? [];

  let bestMatch: { itemId: number; similarity: number } | null = null;
  for (const candidate of [...batch.liveBank, ...batch.batchEmbeddings]) {
    // The local embedding model's vectors are a different dimension than
    // the Voyage-sourced vectors already stored on existing live-bank
    // items -- cosineSimilarity throws on a length mismatch by design, so
    // a mismatched candidate is skipped (not compared against) rather
    // than crashing the whole item. Counted, not silent -- see
    // `GateReport.legacyEmbeddingsSkipped`'s own doc comment for why this
    // is a required fix, not a nice-to-have, and why a backfill to
    // restore full dedup coverage is a deliberate, separate follow-up.
    if (candidate.stemEmbedding.length !== embedding.length) {
      batch.legacyEmbeddingsSkipped += 1;
      continue;
    }
    const similarity = cosineSimilarity(embedding, candidate.stemEmbedding);
    if (!bestMatch || similarity > bestMatch.similarity) {
      bestMatch = { itemId: candidate.itemId, similarity };
    }
  }

  if (bestMatch && bestMatch.similarity >= DUPLICATE_SIMILARITY_THRESHOLD) {
    const itemId = await insertAndPromote(
      'not_run',
      false,
      embedding,
      batch.authoringCostSharePerItem,
      {
        type: 'gates_failed',
      },
    );
    batch.batchEmbeddings.push({ itemId, stemEmbedding: embedding });
    return {
      itemIndex: index,
      itemId,
      outcome: 'gate_failed',
      schemaFailures: [],
      duplicateOfItemId: bestMatch.itemId,
      duplicateSimilarity: bestMatch.similarity,
      independentSolveVerdict: 'not_run',
      riskTier,
      sampledForReview: false,
      inferenceCostUsd: batch.authoringCostSharePerItem,
    };
  }

  const solvePrompt = buildIndependentSolvePrompt(toIndependentSolveInput(draft));
  const solveResult = await withRetry(
    () => callClaudeCli(deps.runCli, { prompt: solvePrompt, model: deps.claudeModel }),
    { ...RETRY_OPTIONS_BASE, sleep: deps.sleep, isRetryable: isRetryableClaudeCliError },
  );
  await logRawResponse(deps.logDir, {
    callType: 'independent_solve',
    objectiveId: options.objectiveId,
    timestamp: deps.now(),
    rawResponse: solveResult.rawResponse,
  });
  const solveCostUsd = computeCallCostUsd(CLAUDE_CLI_PRICING_KEY, solveResult.usage);
  const parsedSolve = parseSolveResponse(solveResult.text);
  const correctLabel = draft.options.find((option) => option.isCorrect)!.label;
  const verdict: IndependentSolveVerdict =
    parsedSolve && parsedSolve.answer === correctLabel ? 'agreed' : 'disagreed';

  // Only a low-risk item's sampling status can change its outcome
  // (`qualifiesForAutomatedRoute` excludes a high-risk item on risk_tier
  // alone) — and risk_tier is already visible in the item's own content, a
  // fact nobody is trying to keep hidden. So there is nothing here for the
  // timing-symmetry convention to protect; skipping the draw for a
  // high-risk item reveals nothing that wasn't already obvious.
  const sampledForReview =
    riskTier === 'low'
      ? shouldSampleForReview(batch.queueConfig.lowRiskSampleRate, deps.random)
      : false;

  const inferenceCostUsd = computeItemInferenceCostUsd(
    batch.authoringCostSharePerItem,
    solveCostUsd,
  );
  const itemFacts: ItemFacts = {
    contributorUserId: null,
    riskTier,
    independentSolveVerdict: verdict,
    sampledForReview,
  };
  const event: LifecycleEvent = qualifiesForAutomatedRoute(itemFacts)
    ? { type: 'auto_gate_promote' }
    : { type: 'gates_passed' };

  const itemId = await insertAndPromote(
    verdict,
    sampledForReview,
    embedding,
    inferenceCostUsd,
    event,
  );
  batch.batchEmbeddings.push({ itemId, stemEmbedding: embedding });

  return {
    itemIndex: index,
    itemId,
    outcome: event.type === 'auto_gate_promote' ? 'auto_gated' : 'pending_review',
    schemaFailures: [],
    duplicateOfItemId: null,
    duplicateSimilarity: bestMatch?.similarity ?? null,
    independentSolveVerdict: verdict,
    riskTier,
    sampledForReview,
    inferenceCostUsd,
  };
}
