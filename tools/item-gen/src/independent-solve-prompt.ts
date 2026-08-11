import type { ItemDraft, OptionLabel } from '@jamb/shared';

/**
 * The independent solve (item-generation-spec.md §3.1, plan 7.4 step 3):
 * a second, separate model call with no sight of the proposed key, asked to
 * solve the item blind. The anti-anchoring discipline the whole review
 * layer rests on (7.10's "answer before key" control) applies here too —
 * the prompt this builds must never carry the key, the distractor
 * rationale, or the explanation.
 *
 * `IndependentSolveInput`'s own shape is the guarantee, not just the
 * prompt text: it has no `isCorrect` or `distractorRationale` field at
 * all, so it is structurally impossible to pass the key into
 * `buildIndependentSolvePrompt` by accident, the same way `RevealResult`
 * and `DecideResult` make a leak a compile-time impossibility rather than
 * a runtime discipline.
 */

export interface IndependentSolveOption {
  label: OptionLabel;
  text: string;
}

export interface IndependentSolveInput {
  stem: string;
  options: IndependentSolveOption[];
}

/** Strips a full item draft down to exactly what the blind solve may see. */
export function toIndependentSolveInput(
  draft: Pick<ItemDraft, 'stem' | 'options'>,
): IndependentSolveInput {
  return {
    stem: draft.stem,
    options: draft.options.map((option) => ({ label: option.label, text: option.text })),
  };
}

export function buildIndependentSolvePrompt(input: IndependentSolveInput): string {
  const optionLines = input.options.map((option) => `${option.label}. ${option.text}`).join('\n');

  return `You are solving a multiple-choice question independently. You have not
been told which option is intended to be correct — work the problem out
yourself and choose the option you believe is correct.

QUESTION:
${input.stem}

OPTIONS:
${optionLines}

Return ONLY valid JSON: {"answer": "A" | "B" | "C" | "D", "reasoning": "<your brief working>"}`;
}
