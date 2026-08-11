import { OPTION_LABELS, type OptionLabel } from './item-lifecycle';

/**
 * Pure logic for the item-generation pipeline's automated gates
 * (item-generation-spec.md §3, plan 7.4/7.5). No I/O, no network, no clock —
 * the API calls, database writes and file logging that surround these live
 * in `tools/item-gen` and `packages/db`.
 */

const COGNITIVE_LEVELS = ['recall', 'comprehension', 'application', 'analysis'] as const;

export interface OptionDraft {
  label: OptionLabel;
  text: string;
  isCorrect: boolean;
  /** The specific named error this option represents. Null only for the correct option. */
  distractorRationale: string | null;
}

export interface ItemDraft {
  stem: string;
  /** Exactly four, in any order — validateItemSchema checks this, callers must not assume it. */
  options: OptionDraft[];
  /**
   * May reference an option via the placeholder `{{OPTION:A}}` (etc.)
   * rather than a literal letter, so `permuteToRebalance` can rewrite the
   * reference deterministically after reshuffling labels — see that
   * function's own doc comment for why a literal-letter regex rewrite
   * would be fragile.
   */
  explanation: string;
  methodSteps: string[];
  cognitiveLevel: string;
  authorDifficulty: number;
  expectedTimeSeconds: number;
  /** The model's own self-report, before `resolveContainsCalculation` combines it with the heuristic. */
  modelReportedContainsCalculation: boolean;
}

/** How many of the batch's items have their correct option at each label. */
export function computeKeyDistribution(items: ItemDraft[]): Record<OptionLabel, number> {
  const counts: Record<OptionLabel, number> = { A: 0, B: 0, C: 0, D: 0 };
  for (const item of items) {
    const correct = item.options.find((option) => option.isCorrect);
    if (correct) {
      counts[correct.label] += 1;
    }
  }
  return counts;
}

function assertValidDraw(random: () => number, callerName: string): number {
  const draw = random();
  if (!Number.isFinite(draw) || draw < 0 || draw >= 1) {
    throw new Error(
      `${callerName}: the random generator must return a draw in [0, 1), but returned ${draw}`,
    );
  }
  return draw;
}

function drawIndex(count: number, random: () => number, callerName: string): number {
  const draw = assertValidDraw(random, callerName);
  return Math.min(count - 1, Math.floor(draw * count));
}

function pickLeastUsedLabel(
  counts: Record<OptionLabel, number>,
  random: () => number,
): OptionLabel {
  const minCount = Math.min(...OPTION_LABELS.map((label) => counts[label]));
  const candidates = OPTION_LABELS.filter((label) => counts[label] === minCount);
  const index = drawIndex(candidates.length, random, 'permuteToRebalance');
  return candidates[index]!;
}

/** Fisher-Yates using the injected generator, for reproducibility in a test. */
function shuffle<T>(values: T[], random: () => number): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = drawIndex(i + 1, random, 'permuteToRebalance');
    const temp = result[i]!;
    result[i] = result[j]!;
    result[j] = temp;
  }
  return result;
}

const OPTION_PLACEHOLDER_PATTERN = /\{\{OPTION:([ABCD])\}\}/g;

function rewritePlaceholders(text: string, mapping: Record<OptionLabel, OptionLabel>): string {
  return text.replace(
    OPTION_PLACEHOLDER_PATTERN,
    (_match, label: OptionLabel) => `{{OPTION:${mapping[label]}}}`,
  );
}

export interface PermutationLogEntry {
  itemIndex: number;
  /** Old label -> new label. */
  mapping: Record<OptionLabel, OptionLabel>;
}

export interface RebalanceResult {
  items: ItemDraft[];
  distributionBefore: Record<OptionLabel, number>;
  distributionAfter: Record<OptionLabel, number>;
  permutations: PermutationLogEntry[];
}

/**
 * Rebalances a batch's A/B/C/D key distribution (item-generation-spec.md
 * §3.2): generated batches skew heavily toward one letter, which a
 * test-wise candidate can exploit. Greedy — each item's correct option is
 * assigned to whichever label has the fewest assignments so far in the
 * batch (ties broken by the injected `random`), which drives the batch as
 * close to even as integer division allows. The three distractors are then
 * shuffled into the remaining slots; their relative order carries no
 * meaning, so this is only for realism, not balance.
 *
 * `explanation`/`methodSteps` reference an option via the `{{OPTION:A}}`
 * placeholder convention (see `ItemDraft`'s own doc comment) rather than a
 * literal letter written by the model — rewriting that placeholder after
 * remapping labels is a deterministic string substitution. Regex-guessing
 * literal letter references in free-form prose written by the model (e.g.
 * distinguishing "option A" from the article "a", or from an unrelated
 * capital letter) is exactly the kind of fragile heuristic this sidesteps
 * by controlling the authoring prompt instead.
 */
export function permuteToRebalance(items: ItemDraft[], random: () => number): RebalanceResult {
  const distributionBefore = computeKeyDistribution(items);
  const runningCounts: Record<OptionLabel, number> = { A: 0, B: 0, C: 0, D: 0 };
  const permutations: PermutationLogEntry[] = [];

  const rebalanced = items.map((item, itemIndex) => {
    const oldCorrectLabel = item.options.find((option) => option.isCorrect)!.label;
    const newCorrectLabel = pickLeastUsedLabel(runningCounts, random);
    runningCounts[newCorrectLabel] += 1;

    const remainingOldLabels = OPTION_LABELS.filter((label) => label !== oldCorrectLabel);
    const remainingNewLabels = shuffle(
      OPTION_LABELS.filter((label) => label !== newCorrectLabel),
      random,
    );

    const mapping = { [oldCorrectLabel]: newCorrectLabel } as Record<OptionLabel, OptionLabel>;
    remainingOldLabels.forEach((oldLabel, i) => {
      mapping[oldLabel] = remainingNewLabels[i]!;
    });
    permutations.push({ itemIndex, mapping });

    const options: OptionDraft[] = item.options.map((option) => ({
      ...option,
      label: mapping[option.label],
    }));

    return {
      ...item,
      options,
      explanation: rewritePlaceholders(item.explanation, mapping),
      methodSteps: item.methodSteps.map((step) => rewritePlaceholders(step, mapping)),
    };
  });

  return {
    items: rebalanced,
    distributionBefore,
    distributionAfter: computeKeyDistribution(rebalanced),
    permutations,
  };
}

export type SchemaValidationFailureReason =
  | 'wrong_option_count'
  | 'not_exactly_one_correct_option'
  | 'missing_distractor_rationale'
  | 'duplicate_option_text'
  | 'all_or_none_of_the_above'
  | 'option_length_outlier'
  | 'empty_stem'
  | 'empty_explanation'
  | 'invalid_cognitive_level';

export interface SchemaValidationResult {
  ok: boolean;
  failures: SchemaValidationFailureReason[];
}

const ALL_OR_NONE_PATTERN = /\b(all|none)\s+of\s+the\s+above\b/i;
/** Longer than this many times the shortest option's length is a length outlier (spec §3.5). */
const LENGTH_OUTLIER_RATIO = 2.5;

function normalizedForComparison(text: string): string {
  return text.trim().toLowerCase();
}

function hasDuplicateOptionText(options: OptionDraft[]): boolean {
  for (let i = 0; i < options.length; i += 1) {
    for (let j = i + 1; j < options.length; j += 1) {
      const a = normalizedForComparison(options[i]!.text);
      const b = normalizedForComparison(options[j]!.text);
      if (a.length === 0 || b.length === 0) {
        continue;
      }
      if (a === b || a.includes(b) || b.includes(a)) {
        return true;
      }
    }
  }
  return false;
}

function hasLengthOutlier(options: OptionDraft[]): boolean {
  const lengths = options.map((option) => option.text.trim().length).filter((length) => length > 0);
  if (lengths.length < 2) {
    return false;
  }
  const shortest = Math.min(...lengths);
  const longest = Math.max(...lengths);
  return shortest > 0 && longest > shortest * LENGTH_OUTLIER_RATIO;
}

/**
 * Schema validation gate (item-generation-spec.md §3.4-3.5): exactly four
 * options, exactly one key, every wrong option carries a
 * distractor_rationale, no substring-duplicate options, no "all/none of
 * the above", no length-outlier option. Collects every failure rather than
 * stopping at the first, so the gate report can show everything wrong with
 * an item at once.
 */
export function validateItemSchema(draft: ItemDraft): SchemaValidationResult {
  const failures: SchemaValidationFailureReason[] = [];

  if (draft.options.length !== 4) {
    failures.push('wrong_option_count');
  } else {
    const correctOptions = draft.options.filter((option) => option.isCorrect);
    if (correctOptions.length !== 1) {
      failures.push('not_exactly_one_correct_option');
    }

    const wrongOptionsMissingRationale = draft.options.some(
      (option) => !option.isCorrect && (option.distractorRationale ?? '').trim().length === 0,
    );
    if (wrongOptionsMissingRationale) {
      failures.push('missing_distractor_rationale');
    }

    if (hasDuplicateOptionText(draft.options)) {
      failures.push('duplicate_option_text');
    }
    if (draft.options.some((option) => ALL_OR_NONE_PATTERN.test(option.text))) {
      failures.push('all_or_none_of_the_above');
    }
    if (hasLengthOutlier(draft.options)) {
      failures.push('option_length_outlier');
    }
  }

  if (draft.stem.trim().length === 0) {
    failures.push('empty_stem');
  }
  if (draft.explanation.trim().length === 0) {
    failures.push('empty_explanation');
  }
  if (!(COGNITIVE_LEVELS as readonly string[]).includes(draft.cognitiveLevel)) {
    failures.push('invalid_cognitive_level');
  }

  return { ok: failures.length === 0, failures };
}

/**
 * Duplicate detection (item-generation-spec.md §3.3) compares stem
 * embeddings by cosine similarity against the live bank. Pure vector math —
 * which embedding provider produced the vectors is `tools/item-gen`'s
 * concern, not this module's.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(
      `cosineSimilarity: vectors must have the same length (${a.length} vs ${b.length})`,
    );
  }

  let dot = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    magnitudeA += a[i]! * a[i]!;
    magnitudeB += b[i]! * b[i]!;
  }

  if (magnitudeA === 0 || magnitudeB === 0) {
    throw new Error('cosineSimilarity: cannot compare against a zero-magnitude vector');
  }

  return dot / (Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB));
}

const OPERATOR_PATTERN = /[+×÷√]|\^\d|\b\d+\s*=\s*\d|%\s*of\b|\bsquared\b|\bcubed\b/i;
const KEYWORD_PATTERN =
  /\b(calculate|compute|evaluate|determine the value|find the value|find the (sum|product|difference|quotient)|how many .*(are|is|does|do)|what is the value|solve for|simplify|correct to \d|significant figures|decimal places)\b/i;
const NUMERIC_OPTION_PATTERN = /^[\s₦$]*-?\d[\d,]*(\.\d+)?\s*[a-zA-Z°%/²³]*\s*$/;

function isNumericOption(text: string): boolean {
  return NUMERIC_OPTION_PATTERN.test(text.trim());
}

/**
 * A defensive heuristic for whether an item contains a calculation, run
 * alongside — never instead of — the model's own self-report. Three
 * independent signals, any one sufficient: an explicit math operator or
 * "squared"/"cubed"/"% of" in the text, a calculation-indicating verb
 * phrase ("calculate", "how many", "what is the value", …), or every
 * option being a bare numeric value (the classic shape of a calculation
 * item's distractors, even when the stem itself names no operator).
 */
export function detectsCalculationHeuristic(stem: string, optionTexts: string[]): boolean {
  const combined = [stem, ...optionTexts].join(' ');
  if (OPERATOR_PATTERN.test(combined)) {
    return true;
  }
  if (KEYWORD_PATTERN.test(combined)) {
    return true;
  }
  return optionTexts.length > 0 && optionTexts.every(isNumericOption);
}

/**
 * `contains_calculation` must not rest on the model's self-report alone
 * (plan 7.3's "single most important control" — a model that mis-tags its
 * own calculation item is exactly the failure this exists to catch). The
 * heuristic can only raise the flag, never lower it: a false positive costs
 * one extra human review; a false negative risks an unreviewed wrong key
 * reaching a candidate.
 */
export function resolveContainsCalculation(
  modelSelfReport: boolean,
  stem: string,
  optionTexts: string[],
): boolean {
  return modelSelfReport || detectsCalculationHeuristic(stem, optionTexts);
}
