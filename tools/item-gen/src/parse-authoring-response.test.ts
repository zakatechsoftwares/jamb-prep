import { describe, expect, it } from 'vitest';
import { parseAuthoringResponse, parseSolveResponse } from './parse-authoring-response';

const VALID_ITEM = {
  id: '1',
  subject: 'Physics',
  topic: 'Mechanics',
  subtopic: 'Force',
  objective: 'x',
  cognitive_level: 'recall',
  author_difficulty: 0.3,
  expected_time_seconds: 40,
  stem: 'What is the SI unit of force?',
  options: { A: 'newton', B: 'joule', C: 'watt', D: 'pascal' },
  correct_option: 'A',
  distractor_rationale: {
    B: 'confuses with energy',
    C: 'confuses with power',
    D: 'confuses with pressure',
  },
  explanation: 'The newton is the SI unit of force.',
  method_steps: ['Recall F = ma.'],
  contains_calculation: false,
  status: 'generated',
};

describe('parseAuthoringResponse', () => {
  it('parses a well-formed array of items', () => {
    const result = parseAuthoringResponse(JSON.stringify([VALID_ITEM]));
    expect(result.discardedCount).toBe(0);
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0]?.stem).toBe(VALID_ITEM.stem);
    expect(result.drafts[0]?.options.find((o) => o.isCorrect)?.text).toBe('newton');
    expect(result.drafts[0]?.options.find((o) => o.label === 'B')?.distractorRationale).toBe(
      'confuses with energy',
    );
  });

  it('strips a markdown code fence around the JSON', () => {
    const result = parseAuthoringResponse('```json\n' + JSON.stringify([VALID_ITEM]) + '\n```');
    expect(result.drafts).toHaveLength(1);
  });

  it('returns nothing for malformed JSON', () => {
    expect(parseAuthoringResponse('not json at all')).toEqual({ drafts: [], discardedCount: 0 });
  });

  it('returns nothing for valid JSON that is not an array', () => {
    expect(parseAuthoringResponse(JSON.stringify({ not: 'an array' }))).toEqual({
      drafts: [],
      discardedCount: 0,
    });
  });

  it('discards an entry missing a stem, counting it separately from the valid ones', () => {
    const result = parseAuthoringResponse(
      JSON.stringify([VALID_ITEM, { ...VALID_ITEM, stem: '' }]),
    );
    expect(result.drafts).toHaveLength(1);
    expect(result.discardedCount).toBe(1);
  });

  it('discards an entry with an invalid correct_option', () => {
    const result = parseAuthoringResponse(JSON.stringify([{ ...VALID_ITEM, correct_option: 'E' }]));
    expect(result.drafts).toHaveLength(0);
    expect(result.discardedCount).toBe(1);
  });

  it('discards an entry with an empty option', () => {
    const result = parseAuthoringResponse(
      JSON.stringify([{ ...VALID_ITEM, options: { A: 'newton', B: '', C: 'watt', D: 'pascal' } }]),
    );
    expect(result.drafts).toHaveLength(0);
    expect(result.discardedCount).toBe(1);
  });

  it('carries contains_calculation through as the model self-report', () => {
    const result = parseAuthoringResponse(
      JSON.stringify([{ ...VALID_ITEM, contains_calculation: true }]),
    );
    expect(result.drafts[0]?.modelReportedContainsCalculation).toBe(true);
  });
});

describe('parseSolveResponse', () => {
  it('parses a valid answer', () => {
    expect(parseSolveResponse(JSON.stringify({ answer: 'B', reasoning: 'because...' }))).toEqual({
      answer: 'B',
    });
  });

  it('returns null for malformed JSON', () => {
    expect(parseSolveResponse('not json')).toBeNull();
  });

  it('returns null for an invalid answer letter', () => {
    expect(parseSolveResponse(JSON.stringify({ answer: 'E' }))).toBeNull();
  });
});
