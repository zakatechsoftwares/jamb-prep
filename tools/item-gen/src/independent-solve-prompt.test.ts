import { describe, expect, it } from 'vitest';
import type { ItemDraft } from '@jamb/shared';
import { buildIndependentSolvePrompt, toIndependentSolveInput } from './independent-solve-prompt';

const FULL_DRAFT: ItemDraft = {
  stem: 'What is the molar mass of sodium chloride (NaCl)?',
  options: [
    { label: 'A', text: '58.5 g/mol', isCorrect: true, distractorRationale: null },
    {
      label: 'B',
      text: '35.5 g/mol',
      isCorrect: false,
      distractorRationale: 'CONFIDENTIAL: uses only the mass of chlorine, forgetting sodium',
    },
    {
      label: 'C',
      text: '23.0 g/mol',
      isCorrect: false,
      distractorRationale: 'CONFIDENTIAL: uses only the mass of sodium, forgetting chlorine',
    },
    {
      label: 'D',
      text: '81.5 g/mol',
      isCorrect: false,
      distractorRationale: 'CONFIDENTIAL: adds an extra chlorine atom by mistake',
    },
  ],
  explanation:
    'CONFIDENTIAL EXPLANATION: {{OPTION:A}} is correct because Na (23.0) + Cl (35.5) = 58.5 g/mol.',
  methodSteps: ['CONFIDENTIAL: add atomic masses of Na and Cl.'],
  cognitiveLevel: 'application',
  authorDifficulty: 0.5,
  expectedTimeSeconds: 60,
  modelReportedContainsCalculation: true,
};

describe('toIndependentSolveInput / buildIndependentSolvePrompt', () => {
  it('carries no distractor_rationale, explanation, method_steps, or correctness flag into the prompt', () => {
    const solveInput = toIndependentSolveInput(FULL_DRAFT);
    const prompt = buildIndependentSolvePrompt(solveInput);

    // The whole point of a blind solve: nothing marked CONFIDENTIAL above —
    // every explanation, rationale and method-step string — may appear.
    expect(prompt).not.toContain('CONFIDENTIAL');
    for (const option of FULL_DRAFT.options) {
      if (option.distractorRationale) {
        expect(prompt).not.toContain(option.distractorRationale);
      }
    }
    expect(prompt).not.toContain(FULL_DRAFT.explanation);
    for (const step of FULL_DRAFT.methodSteps) {
      expect(prompt).not.toContain(step);
    }

    // No structural hint of which option is correct either.
    expect(prompt.toLowerCase()).not.toMatch(/is_?correct|correct_?option|the correct answer is/);
  });

  it("still includes the stem and every option's letter and text, so the model can actually answer", () => {
    const prompt = buildIndependentSolvePrompt(toIndependentSolveInput(FULL_DRAFT));

    expect(prompt).toContain(FULL_DRAFT.stem);
    for (const option of FULL_DRAFT.options) {
      expect(prompt).toContain(`${option.label}. ${option.text}`);
    }
  });

  it("toIndependentSolveInput's own return type has no field to carry a key through, even if a caller tried", () => {
    const solveInput = toIndependentSolveInput(FULL_DRAFT);
    expect(Object.keys(solveInput)).toEqual(['stem', 'options']);
    for (const option of solveInput.options) {
      expect(Object.keys(option).sort()).toEqual(['label', 'text']);
    }
  });
});
