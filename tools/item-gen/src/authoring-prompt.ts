/**
 * The authoring prompt (item-generation-spec.md §4), with one addition: the
 * requested JSON schema in the spec's own text has no `contains_calculation`
 * field, but `resolveContainsCalculation`/`deriveRiskTier` need the model's
 * self-report as an input — risk tiering (plan 7.3) cannot rest on subject
 * alone, since a Biology genetics-ratio item is a calculation too. The
 * `{{OPTION:X}}` placeholder instruction is this pipeline's own addition as
 * well, for `permuteToRebalance` to rewrite deterministically — see that
 * function's doc comment in `item-gen-gates.ts`.
 */

export type DifficultyTarget = 'easy' | 'moderate' | 'challenging';

export interface AuthoringPromptInput {
  subject: string;
  topic: string;
  subtopic: string;
  objectiveText: string;
  difficultyTarget: DifficultyTarget;
  cognitiveLevel: string;
  count: number;
}

export function buildAuthoringPrompt(input: AuthoringPromptInput): string {
  return `You are an experienced Nigerian secondary school teacher authoring practice
items for the JAMB UTME.

SUBJECT: ${input.subject}
TOPIC: ${input.topic}
SUBTOPIC: ${input.subtopic}
SYLLABUS OBJECTIVE: ${input.objectiveText}
DIFFICULTY TARGET: ${input.difficultyTarget}
COGNITIVE LEVEL: ${input.cognitiveLevel}
COUNT: ${input.count}

Write ${input.count} original multiple-choice items meeting ALL of the following:

STYLE
- Match the register, length and phrasing conventions of the JAMB UTME.
- Exactly four options, lettered A to D, exactly one unambiguously correct.
- Answerable in about 40 seconds by a well-prepared candidate.
- Use Nigerian contexts and naira amounts where a context is needed.
- SI units, standard chemical and mathematical notation.

DISTRACTORS
- Every distractor must be the result of a SPECIFIC, NAMED plausible error
  (wrong formula, unit not converted, sign error, common misconception).
- State that error in the "distractor_rationale" field for each option.
- No "all of the above", no "none of the above", no joke options.
- Keep all four options similar in length and grammatical form.

EXPLANATIONS
- Teach the method, not just the answer.
- Show every step of the working for calculations.
- Name the specific misconception the most attractive distractor represents.
- Reference an option using the placeholder {{OPTION:A}}, {{OPTION:B}},
  {{OPTION:C}} or {{OPTION:D}} instead of writing the letter directly — for
  example write "because {{OPTION:A}} incorrectly assumes..." rather than
  "because option A incorrectly assumes...". The options may be relabelled
  after you respond, and the placeholder is what keeps your explanation
  correct after that happens.

CONSTRAINTS
- Do NOT reproduce or closely paraphrase any past examination question.
- Do NOT write items requiring a diagram, graph or image.
- Do NOT reference the JAMB recommended reading text.
- If you cannot write a defensible item for this objective, return fewer
  items rather than padding.

Return ONLY valid JSON, an array of objects with these keys:
id, subject, topic, subtopic, objective, cognitive_level,
author_difficulty (0-1), expected_time_seconds, stem, options {A,B,C,D},
correct_option, distractor_rationale {A,B,C,D}, explanation,
method_steps (array), contains_calculation (boolean — true if answering this
item requires any arithmetic or algebraic calculation, false otherwise),
status ("generated")`;
}
