import { describe, expect, it } from 'vitest';
import {
  computeKeyDistribution,
  cosineSimilarity,
  detectsCalculationHeuristic,
  permuteToRebalance,
  resolveContainsCalculation,
  validateItemSchema,
  type ItemDraft,
} from './item-gen-gates';

function draft(overrides: Partial<ItemDraft> = {}): ItemDraft {
  return {
    stem: 'What is the SI unit of force?',
    options: [
      { label: 'A', text: 'newton', isCorrect: true, distractorRationale: null },
      {
        label: 'B',
        text: 'joule',
        isCorrect: false,
        distractorRationale: 'confuses force with energy',
      },
      {
        label: 'C',
        text: 'watt',
        isCorrect: false,
        distractorRationale: 'confuses force with power',
      },
      {
        label: 'D',
        text: 'pascal',
        isCorrect: false,
        distractorRationale: 'confuses force with pressure',
      },
    ],
    explanation: "The newton, {{OPTION:A}}, is the SI unit of force per Newton's second law.",
    methodSteps: ['Recall F = ma, so the unit of force is {{OPTION:A}}.'],
    cognitiveLevel: 'recall',
    authorDifficulty: 0.3,
    expectedTimeSeconds: 40,
    modelReportedContainsCalculation: false,
    ...overrides,
  };
}

describe('computeKeyDistribution', () => {
  it('counts how many items have their correct option at each label', () => {
    const items = [
      draft(),
      draft({
        options: [
          { label: 'A', text: 'x', isCorrect: false, distractorRationale: 'wrong' },
          { label: 'B', text: 'y', isCorrect: true, distractorRationale: null },
          { label: 'C', text: 'z', isCorrect: false, distractorRationale: 'wrong' },
          { label: 'D', text: 'w', isCorrect: false, distractorRationale: 'wrong' },
        ],
      }),
    ];
    expect(computeKeyDistribution(items)).toEqual({ A: 1, B: 1, C: 0, D: 0 });
  });

  it('returns all zeros for an empty batch', () => {
    expect(computeKeyDistribution([])).toEqual({ A: 0, B: 0, C: 0, D: 0 });
  });
});

describe('permuteToRebalance', () => {
  it('rebalances a batch skewed entirely onto one label toward an even distribution', () => {
    const items = Array.from({ length: 8 }, () => draft());
    // Every item starts correct-at-A.
    expect(computeKeyDistribution(items)).toEqual({ A: 8, B: 0, C: 0, D: 0 });

    let call = 0;
    // Deterministic sequence — enough draws for 8 items' worth of slot
    // selection and distractor shuffling.
    const random = () => {
      const sequence = [0, 0.9, 0.1, 0.6, 0.4, 0.3, 0.7, 0.2];
      const value = sequence[call % sequence.length]!;
      call += 1;
      return value;
    };

    const result = permuteToRebalance(items, random);

    expect(result.distributionBefore).toEqual({ A: 8, B: 0, C: 0, D: 0 });
    // Perfectly even across 8 items and 4 labels.
    expect(result.distributionAfter).toEqual({ A: 2, B: 2, C: 2, D: 2 });
  });

  it("preserves every option's text and rationale content while remapping which label it sits under", () => {
    const items = [draft()];
    const result = permuteToRebalance(items, () => 0.5);

    const resultingTexts = result.items[0]!.options.map((o) => o.text).sort();
    expect(resultingTexts).toEqual(['joule', 'newton', 'pascal', 'watt']);

    const correct = result.items[0]!.options.find((o) => o.isCorrect);
    expect(correct?.text).toBe('newton');
    expect(correct?.distractorRationale).toBeNull();
  });

  it('rewrites {{OPTION:X}} placeholders in the explanation and method steps to match the new label', () => {
    const items = [draft()];
    // Force the correct option (originally A) to move to D.
    const result = permuteToRebalance(items, () => 0.99);

    const mapping = result.permutations[0]!.mapping;
    const newCorrectLabel = mapping.A;
    const correct = result.items[0]!.options.find((o) => o.isCorrect);
    expect(correct?.label).toBe(newCorrectLabel);

    expect(result.items[0]!.explanation).toContain(`{{OPTION:${newCorrectLabel}}}`);
    expect(result.items[0]!.explanation).not.toContain('{{OPTION:A}}');
    expect(result.items[0]!.methodSteps[0]).toContain(`{{OPTION:${newCorrectLabel}}}`);
  });

  it('is deterministic given the same random sequence', () => {
    const items = [draft(), draft()];
    const sequence = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
    const randomOf = () => {
      let call = 0;
      return () => sequence[call++ % sequence.length]!;
    };

    const first = permuteToRebalance(items, randomOf());
    const second = permuteToRebalance(items, randomOf());
    expect(first.items.map((i) => i.options.map((o) => o.label))).toEqual(
      second.items.map((i) => i.options.map((o) => o.label)),
    );
  });

  it('throws when the random generator returns a draw outside [0, 1)', () => {
    expect(() => permuteToRebalance([draft()], () => 1)).toThrow(/random/i);
    expect(() => permuteToRebalance([draft()], () => -0.1)).toThrow(/random/i);
  });
});

describe('validateItemSchema', () => {
  it('passes a well-formed item', () => {
    expect(validateItemSchema(draft())).toEqual({ ok: true, failures: [] });
  });

  it('flags the wrong option count', () => {
    const bad = draft({ options: draft().options.slice(0, 3) });
    expect(validateItemSchema(bad).failures).toContain('wrong_option_count');
  });

  it('flags when there is not exactly one correct option', () => {
    const none = draft({
      options: draft().options.map((o) => ({ ...o, isCorrect: false })),
    });
    expect(validateItemSchema(none).failures).toContain('not_exactly_one_correct_option');

    const two = draft({
      options: draft().options.map((o, i) => ({ ...o, isCorrect: i < 2 })),
    });
    expect(validateItemSchema(two).failures).toContain('not_exactly_one_correct_option');
  });

  it('flags a wrong option missing its distractor_rationale', () => {
    const bad = draft({
      options: draft().options.map((o) =>
        o.label === 'B' ? { ...o, distractorRationale: '' } : o,
      ),
    });
    expect(validateItemSchema(bad).failures).toContain('missing_distractor_rationale');
  });

  it('flags duplicate or substring-duplicate option text', () => {
    const bad = draft({
      options: draft().options.map((o) => (o.label === 'B' ? { ...o, text: 'newton unit' } : o)),
    });
    expect(validateItemSchema(bad).failures).toContain('duplicate_option_text');
  });

  it('flags "all of the above" and "none of the above"', () => {
    const all = draft({
      options: draft().options.map((o) =>
        o.label === 'D' ? { ...o, text: 'All of the above' } : o,
      ),
    });
    expect(validateItemSchema(all).failures).toContain('all_or_none_of_the_above');

    const none = draft({
      options: draft().options.map((o) =>
        o.label === 'D' ? { ...o, text: 'None of the above' } : o,
      ),
    });
    expect(validateItemSchema(none).failures).toContain('all_or_none_of_the_above');
  });

  it('flags a length-outlier option', () => {
    const bad = draft({
      options: draft().options.map((o) =>
        o.label === 'D'
          ? { ...o, text: 'a very much longer option than the other three by a wide margin' }
          : o,
      ),
    });
    expect(validateItemSchema(bad).failures).toContain('option_length_outlier');
  });

  it('flags an empty stem or explanation', () => {
    expect(validateItemSchema(draft({ stem: '  ' })).failures).toContain('empty_stem');
    expect(validateItemSchema(draft({ explanation: '' })).failures).toContain('empty_explanation');
  });

  it('flags an invalid cognitive level', () => {
    expect(validateItemSchema(draft({ cognitiveLevel: 'expert' })).failures).toContain(
      'invalid_cognitive_level',
    );
  });

  it('collects every failure at once rather than stopping at the first', () => {
    const bad = draft({ stem: '', explanation: '', cognitiveLevel: 'expert' });
    const result = validateItemSchema(bad);
    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(
      expect.arrayContaining(['empty_stem', 'empty_explanation', 'invalid_cognitive_level']),
    );
  });
});

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });

  it('returns -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 2], [-1, -2])).toBeCloseTo(-1, 6);
  });

  it('throws on mismatched vector lengths', () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow(/length/i);
  });

  it('throws on a zero-magnitude vector', () => {
    expect(() => cosineSimilarity([0, 0], [1, 2])).toThrow(/zero/i);
  });
});

describe('detectsCalculationHeuristic', () => {
  it('detects an explicit math operator in the stem', () => {
    expect(
      detectsCalculationHeuristic('If 3x + 7 = 22, what is the value of x?', ['3', '5', '7', '9']),
    ).toBe(true);
  });

  it('detects a calculation-indicating keyword phrase', () => {
    expect(
      detectsCalculationHeuristic('Calculate the molar mass of sodium chloride.', [
        '58.5 g/mol',
        '35.5 g/mol',
        '23.0 g/mol',
        '81.5 g/mol',
      ]),
    ).toBe(true);
  });

  it('detects all-numeric options with no operator or keyword in the stem', () => {
    expect(
      detectsCalculationHeuristic('A car accelerates uniformly. What is its final velocity?', [
        '12.5 m/s',
        '25.0 m/s',
        '8.3 m/s',
        '15.6 m/s',
      ]),
    ).toBe(true);
  });

  it('returns false for a plain recall item', () => {
    expect(
      detectsCalculationHeuristic('What is the SI unit of force?', [
        'newton',
        'joule',
        'watt',
        'pascal',
      ]),
    ).toBe(false);
  });
});

describe('resolveContainsCalculation', () => {
  it('is true when the model self-reports true, regardless of the heuristic', () => {
    expect(
      resolveContainsCalculation(true, 'What is the SI unit of force?', [
        'newton',
        'joule',
        'watt',
        'pascal',
      ]),
    ).toBe(true);
  });

  it('raises to true when the model under-reports but the heuristic detects an operator', () => {
    expect(
      resolveContainsCalculation(false, 'If 3x + 7 = 22, what is the value of x?', [
        '3',
        '5',
        '7',
        '9',
      ]),
    ).toBe(true);
  });

  it('is false only when both the model and the heuristic agree there is no calculation', () => {
    expect(
      resolveContainsCalculation(false, 'What is the SI unit of force?', [
        'newton',
        'joule',
        'watt',
        'pascal',
      ]),
    ).toBe(false);
  });

  it('never lowers a true self-report even when the heuristic finds nothing', () => {
    expect(
      resolveContainsCalculation(true, 'Which of these is a noble gas?', [
        'helium',
        'chlorine',
        'oxygen',
        'nitrogen',
      ]),
    ).toBe(true);
  });
});
