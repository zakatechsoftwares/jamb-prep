import { describe, expect, it } from 'vitest';
import { OPTION_LABELS, REJECTION_REASONS, REVIEW_ACTIONS } from './item-lifecycle';
import {
  agreesWithKey,
  buildItemEditDiff,
  canReveal,
  parseDecisionInput,
  parseOptionLabel,
  type ItemSnapshot,
} from './review-decision-policy';

const CURRENT: ItemSnapshot = {
  stem: 'What is the SI unit of force?',
  options: { A: 'newton', B: 'joule', C: 'watt', D: 'pascal' },
  key: 'A',
  explanation: "Force is measured in newtons, per Newton's second law.",
  objectiveId: 7,
};

// ---------------------------------------------------------------------------
// parseOptionLabel
// ---------------------------------------------------------------------------

describe('parseOptionLabel', () => {
  it.each(OPTION_LABELS)('accepts %s', (label) => {
    expect(parseOptionLabel(label, 'answer')).toBe(label);
  });

  it('throws on a lowercase letter', () => {
    expect(() => parseOptionLabel('a', 'answer')).toThrow();
  });

  it('throws on a letter outside A-D', () => {
    expect(() => parseOptionLabel('E', 'answer')).toThrow();
  });

  it('throws on an empty string', () => {
    expect(() => parseOptionLabel('', 'answer')).toThrow();
  });

  it('throws on a number', () => {
    expect(() => parseOptionLabel(1, 'answer')).toThrow();
  });

  it('throws on null and undefined', () => {
    expect(() => parseOptionLabel(null, 'answer')).toThrow();
    expect(() => parseOptionLabel(undefined, 'answer')).toThrow();
  });

  it('names the offending field in the error, so a bad request is diagnosable', () => {
    expect(() => parseOptionLabel('Z', 'reviewerAnswer')).toThrow(/reviewerAnswer/);
    expect(() => parseOptionLabel('Z', 'edits.key')).toThrow(/edits\.key/);
  });
});

// ---------------------------------------------------------------------------
// canReveal — the anti-anchoring gate
// ---------------------------------------------------------------------------

describe('canReveal', () => {
  it('permits reveal on a low-risk item with no blind answer recorded', () => {
    expect(canReveal('low', false)).toBe(true);
  });

  it('permits reveal on a low-risk item once an answer is recorded', () => {
    expect(canReveal('low', true)).toBe(true);
  });

  it('permits reveal on a human-authored (not_generated) item regardless of an answer', () => {
    expect(canReveal('not_generated', false)).toBe(true);
    expect(canReveal('not_generated', true)).toBe(true);
  });

  it('withholds a high risk_tier item until a blind answer is recorded', () => {
    // Plan 7.10: the tool requires the reviewer's own answer before the
    // proposed key is revealed. This is the single highest-value control
    // in the framework, and it applies to every calculation item.
    expect(canReveal('high', false)).toBe(false);
  });

  it('permits reveal on a high risk_tier item once the blind answer is recorded', () => {
    expect(canReveal('high', true)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// agreesWithKey
// ---------------------------------------------------------------------------

describe('agreesWithKey', () => {
  it('returns null when no blind answer was ever recorded', () => {
    // Null, not false: "never solved" and "solved and disagreed" are
    // different facts, and collapsing them would hide the difference from
    // whatever reads this later (reviewer accuracy, 7.11).
    expect(agreesWithKey(null, 'A')).toBeNull();
  });

  it('returns true when the blind answer matches the key', () => {
    expect(agreesWithKey('B', 'B')).toBe(true);
  });

  it('returns false when the blind answer does not match the key', () => {
    expect(agreesWithKey('C', 'D')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildItemEditDiff
// ---------------------------------------------------------------------------

describe('buildItemEditDiff', () => {
  it('throws on a completely empty patch', () => {
    expect(() => buildItemEditDiff(CURRENT, {})).toThrow(/change/i);
  });

  it('throws when every patched field equals its current value', () => {
    // The shape looks like an edit but nothing would actually change —
    // that is what `approve` is for, not `edit_and_approve`.
    expect(() => buildItemEditDiff(CURRENT, { stem: CURRENT.stem })).toThrow(/change/i);
  });

  it('records a stem-only change and nothing else', () => {
    const diff = buildItemEditDiff(CURRENT, { stem: 'What SI unit measures force?' });

    expect(diff).toEqual({
      stem: { before: CURRENT.stem, after: 'What SI unit measures force?' },
    });
  });

  it('records an explanation-only change', () => {
    const diff = buildItemEditDiff(CURRENT, { explanation: 'Corrected explanation.' });

    expect(diff).toEqual({
      explanation: { before: CURRENT.explanation, after: 'Corrected explanation.' },
    });
  });

  it('records an objectiveId-only change', () => {
    const diff = buildItemEditDiff(CURRENT, { objectiveId: 12 });

    expect(diff).toEqual({ objectiveId: { before: 7, after: 12 } });
  });

  it('records a key-only change', () => {
    const diff = buildItemEditDiff(CURRENT, { key: 'B' });

    expect(diff).toEqual({ key: { before: 'A', after: 'B' } });
  });

  it('records only the option labels that actually changed', () => {
    const diff = buildItemEditDiff(CURRENT, { options: { B: 'kilojoule' } });

    expect(diff).toEqual({ options: { B: { before: 'joule', after: 'kilojoule' } } });
  });

  it('omits an option label from the diff when its patched value equals the current one', () => {
    // C is present in the patch but unchanged; only B should surface.
    const diff = buildItemEditDiff(CURRENT, { options: { B: 'kilojoule', C: CURRENT.options.C } });

    expect(diff.options).toEqual({ B: { before: 'joule', after: 'kilojoule' } });
    expect(diff.options).not.toHaveProperty('C');
  });

  it('combines several changed fields into one diff with exactly those keys', () => {
    const diff = buildItemEditDiff(CURRENT, {
      stem: 'Revised stem',
      key: 'C',
      options: { D: 'revised distractor' },
    });

    expect(diff).toEqual({
      stem: { before: CURRENT.stem, after: 'Revised stem' },
      key: { before: 'A', after: 'C' },
      options: { D: { before: 'pascal', after: 'revised distractor' } },
    });
    expect(diff).not.toHaveProperty('explanation');
    expect(diff).not.toHaveProperty('objectiveId');
  });

  it('is pure: it does not mutate the snapshot it was given', () => {
    const snapshot = { ...CURRENT, options: { ...CURRENT.options } };

    buildItemEditDiff(snapshot, { stem: 'Something else entirely' });

    expect(snapshot).toEqual(CURRENT);
  });
});

// ---------------------------------------------------------------------------
// parseDecisionInput
// ---------------------------------------------------------------------------

describe('parseDecisionInput', () => {
  it('parses a bare approve', () => {
    expect(parseDecisionInput({ action: 'approve' })).toEqual({
      action: 'approve',
      rejectionReason: null,
      edits: null,
    });
  });

  it('parses a bare escalate', () => {
    expect(parseDecisionInput({ action: 'escalate' })).toEqual({
      action: 'escalate',
      rejectionReason: null,
      edits: null,
    });
  });

  it.each(REJECTION_REASONS)('parses a reject with reason %s', (reason) => {
    expect(parseDecisionInput({ action: 'reject', rejectionReason: reason })).toEqual({
      action: 'reject',
      rejectionReason: reason,
      edits: null,
    });
  });

  it('parses an edit_and_approve carrying a patch', () => {
    const result = parseDecisionInput({
      action: 'edit_and_approve',
      edits: { stem: 'New stem text' },
    });

    expect(result).toEqual({
      action: 'edit_and_approve',
      rejectionReason: null,
      edits: { stem: 'New stem text' },
    });
  });

  it('parses a full edit patch across every editable field', () => {
    const patch = {
      stem: 'New stem',
      options: { A: 'first', B: 'second' },
      key: 'B',
      explanation: 'New explanation',
      objectiveId: 3,
    };

    expect(parseDecisionInput({ action: 'edit_and_approve', edits: patch }).edits).toEqual(patch);
  });

  describe('rejects malformed input', () => {
    it('throws when the raw input is not an object', () => {
      for (const bad of ['approve', 42, null, undefined, [], true]) {
        expect(() => parseDecisionInput(bad)).toThrow();
      }
    });

    it('throws on an unrecognised action', () => {
      expect(() => parseDecisionInput({ action: 'approved' })).toThrow(/action/i);
    });

    it('throws when action is missing or not a string', () => {
      expect(() => parseDecisionInput({})).toThrow(/action/i);
      expect(() => parseDecisionInput({ action: 3 })).toThrow(/action/i);
      expect(() => parseDecisionInput({ action: null })).toThrow(/action/i);
    });

    it('throws when reject has no rejectionReason', () => {
      expect(() => parseDecisionInput({ action: 'reject' })).toThrow(/rejectionReason/i);
    });

    it('throws when rejectionReason is free text rather than the fixed enum', () => {
      // The DONE WHEN requirement, stated directly: free-text rejection
      // reasons are never accepted, however plausible they read.
      expect(() =>
        parseDecisionInput({
          action: 'reject',
          rejectionReason: 'I think the key is wrong here',
        }),
      ).toThrow(/rejectionReason/i);
    });

    it('throws when rejectionReason is merely a case-mismatch of a real reason', () => {
      expect(() => parseDecisionInput({ action: 'reject', rejectionReason: 'WRONG_KEY' })).toThrow(
        /rejectionReason/i,
      );
    });

    it.each(['approve', 'edit_and_approve', 'escalate'] as const)(
      'throws when %s carries a rejectionReason',
      (action) => {
        const edits = action === 'edit_and_approve' ? { stem: 'x' } : undefined;
        expect(() => parseDecisionInput({ action, rejectionReason: 'wrong_key', edits })).toThrow(
          /rejectionReason/i,
        );
      },
    );

    it('throws when edit_and_approve has no edits', () => {
      expect(() => parseDecisionInput({ action: 'edit_and_approve' })).toThrow(/edits/i);
    });

    it.each(['approve', 'reject', 'escalate'] as const)(
      'throws when %s carries edits',
      (action) => {
        const rejectionReason = action === 'reject' ? 'wrong_key' : undefined;
        expect(() => parseDecisionInput({ action, rejectionReason, edits: { stem: 'x' } })).toThrow(
          /edits/i,
        );
      },
    );

    it('throws when edits is not an object', () => {
      for (const bad of ['x', 1, null, [], true]) {
        expect(() => parseDecisionInput({ action: 'edit_and_approve', edits: bad })).toThrow(
          /edits/i,
        );
      }
    });

    it('throws when edits is an empty object', () => {
      expect(() => parseDecisionInput({ action: 'edit_and_approve', edits: {} })).toThrow(/edits/i);
    });

    it('throws when edits carries an unrecognised field', () => {
      expect(() =>
        parseDecisionInput({
          action: 'edit_and_approve',
          edits: { status: 'approved_uncalibrated' },
        }),
      ).toThrow(/status/i);
    });

    it('throws when edits.stem is empty or whitespace-only', () => {
      expect(() => parseDecisionInput({ action: 'edit_and_approve', edits: { stem: '' } })).toThrow(
        /stem/i,
      );
      expect(() =>
        parseDecisionInput({ action: 'edit_and_approve', edits: { stem: '   ' } }),
      ).toThrow(/stem/i);
    });

    it('throws when edits.stem is not a string', () => {
      expect(() =>
        parseDecisionInput({ action: 'edit_and_approve', edits: { stem: 123 } }),
      ).toThrow(/stem/i);
    });

    it('throws when edits.key is outside A-D', () => {
      expect(() => parseDecisionInput({ action: 'edit_and_approve', edits: { key: 'E' } })).toThrow(
        /key/i,
      );
      expect(() => parseDecisionInput({ action: 'edit_and_approve', edits: { key: 'a' } })).toThrow(
        /key/i,
      );
    });

    it('throws when edits.objectiveId is not a positive integer', () => {
      for (const bad of [0, -5, 1.5, '7']) {
        expect(() =>
          parseDecisionInput({ action: 'edit_and_approve', edits: { objectiveId: bad } }),
        ).toThrow(/objectiveId/i);
      }
    });

    it('throws when edits.options is present but empty', () => {
      expect(() =>
        parseDecisionInput({ action: 'edit_and_approve', edits: { options: {} } }),
      ).toThrow(/options/i);
    });

    it('throws when edits.options has an unrecognised label', () => {
      expect(() =>
        parseDecisionInput({
          action: 'edit_and_approve',
          edits: { options: { E: 'not a real label' } },
        }),
      ).toThrow(/options/i);
    });

    it('throws when an edits.options value is empty or not a string', () => {
      expect(() =>
        parseDecisionInput({ action: 'edit_and_approve', edits: { options: { A: '' } } }),
      ).toThrow(/options/i);
      expect(() =>
        parseDecisionInput({ action: 'edit_and_approve', edits: { options: { A: 5 } } }),
      ).toThrow(/options/i);
    });
  });

  it('covers every review action and every rejection reason, so growing either vocabulary is noticed here', () => {
    expect(REVIEW_ACTIONS).toHaveLength(4);
    expect(REJECTION_REASONS).toHaveLength(8);
  });
});
