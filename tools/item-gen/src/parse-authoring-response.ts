import { OPTION_LABELS, type ItemDraft, type OptionDraft, type OptionLabel } from '@jamb/shared';

/**
 * Turns the authoring call's raw text into `ItemDraft`s. An entry that is
 * too malformed to become even a schema-gate candidate (no usable stem, no
 * valid correct_option, an option with empty text) is dropped here —
 * `discardedCount` is how many, since those never become a database row at
 * all and so need to be accounted for separately from a `gate_failed` item.
 * Everything that DOES survive this parse still goes through
 * `validateItemSchema` — this function only asks "can I build the shape,"
 * not "is the content any good."
 */
export interface ParsedAuthoringResponse {
  drafts: ItemDraft[];
  discardedCount: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  return fenceMatch ? fenceMatch[1]!.trim() : trimmed;
}

function tryParseDraft(raw: unknown): ItemDraft | null {
  if (!isRecord(raw)) {
    return null;
  }

  const stem = raw.stem;
  if (typeof stem !== 'string' || stem.trim().length === 0) {
    return null;
  }

  const correctOption = raw.correct_option;
  if (
    typeof correctOption !== 'string' ||
    !(OPTION_LABELS as readonly string[]).includes(correctOption)
  ) {
    return null;
  }

  const rawOptions = isRecord(raw.options) ? raw.options : null;
  const rawRationale = isRecord(raw.distractor_rationale) ? raw.distractor_rationale : {};
  if (!rawOptions) {
    return null;
  }

  const options: OptionDraft[] = OPTION_LABELS.map((label) => {
    const text = rawOptions[label];
    const rationale = rawRationale[label];
    return {
      label,
      text: typeof text === 'string' ? text : '',
      isCorrect: label === correctOption,
      distractorRationale:
        label === correctOption ? null : typeof rationale === 'string' ? rationale : null,
    };
  });

  if (options.some((option) => option.text.trim().length === 0)) {
    return null;
  }

  const methodSteps = Array.isArray(raw.method_steps)
    ? raw.method_steps.filter((step): step is string => typeof step === 'string')
    : [];

  return {
    stem,
    options,
    explanation: typeof raw.explanation === 'string' ? raw.explanation : '',
    methodSteps,
    cognitiveLevel: typeof raw.cognitive_level === 'string' ? raw.cognitive_level : '',
    authorDifficulty: typeof raw.author_difficulty === 'number' ? raw.author_difficulty : 0.5,
    expectedTimeSeconds:
      typeof raw.expected_time_seconds === 'number' ? raw.expected_time_seconds : 60,
    modelReportedContainsCalculation: raw.contains_calculation === true,
  };
}

export function parseAuthoringResponse(rawText: string): ParsedAuthoringResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFences(rawText));
  } catch {
    return { drafts: [], discardedCount: 0 };
  }

  if (!Array.isArray(parsed)) {
    return { drafts: [], discardedCount: 0 };
  }

  const drafts: ItemDraft[] = [];
  let discardedCount = 0;
  for (const raw of parsed) {
    const draft = tryParseDraft(raw);
    if (draft) {
      drafts.push(draft);
    } else {
      discardedCount += 1;
    }
  }

  return { drafts, discardedCount };
}

/** Exposed for the independent-solve response, which is a single object, not an array. */
export function parseSolveResponse(rawText: string): { answer: OptionLabel } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFences(rawText));
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }
  const answer = parsed.answer;
  if (typeof answer !== 'string' || !(OPTION_LABELS as readonly string[]).includes(answer)) {
    return null;
  }

  return { answer: answer as OptionLabel };
}
