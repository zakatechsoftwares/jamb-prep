import { describe, expect, it } from 'vitest';
import {
  applyPracticeEvent,
  initPracticeSession,
  practiceSummary,
  type PracticeSessionState,
} from './practice-session-reducer';

const ITEMS = [
  { itemId: 10, correctOption: 'A' as const },
  { itemId: 11, correctOption: 'C' as const },
  { itemId: 12, correctOption: 'D' as const },
];

function fresh(): PracticeSessionState {
  return initPracticeSession(ITEMS);
}

function answer(state: PracticeSessionState, option: 'A' | 'B' | 'C' | 'D'): PracticeSessionState {
  const selected = applyPracticeEvent(state, { type: 'select', option });
  return applyPracticeEvent(selected, { type: 'submit' });
}

describe('initPracticeSession', () => {
  it('starts on the first question with nothing selected, answered or finished', () => {
    expect(fresh()).toEqual({
      items: ITEMS,
      currentIndex: 0,
      pendingSelection: null,
      answers: {},
      finished: false,
    });
  });

  it('throws on an empty item list', () => {
    expect(() => initPracticeSession([])).toThrow(/items/);
  });

  it('throws on a duplicate item id', () => {
    expect(() => initPracticeSession([...ITEMS, { itemId: 10, correctOption: 'B' }])).toThrow(/10/);
  });

  it('throws on a correct option outside A–D', () => {
    expect(() =>
      initPracticeSession([{ itemId: 1, correctOption: 'E' as unknown as 'A' }]),
    ).toThrow(/correctOption/);
  });
});

describe('select and submit', () => {
  it('holds a selection until it is submitted', () => {
    const state = applyPracticeEvent(fresh(), { type: 'select', option: 'B' });
    expect(state.pendingSelection).toBe('B');
    expect(state.answers).toEqual({});
  });

  it('lets the candidate change their selection before submitting', () => {
    let state = applyPracticeEvent(fresh(), { type: 'select', option: 'B' });
    state = applyPracticeEvent(state, { type: 'select', option: 'A' });
    expect(state.pendingSelection).toBe('A');
  });

  it('records a correct answer against the item, and stays on it to show the explanation', () => {
    const state = answer(fresh(), 'A');
    expect(state.answers).toEqual({ 10: { selected: 'A', isCorrect: true } });
    expect(state.currentIndex).toBe(0);
    expect(state.pendingSelection).toBeNull();
  });

  it('records a wrong answer as wrong', () => {
    expect(answer(fresh(), 'B').answers[10]).toEqual({ selected: 'B', isCorrect: false });
  });

  it('throws on submit with nothing selected', () => {
    expect(() => applyPracticeEvent(fresh(), { type: 'submit' })).toThrow(/select/);
  });

  it('makes an answered question review-only: selecting or submitting again throws', () => {
    const answered = answer(fresh(), 'A');
    expect(() => applyPracticeEvent(answered, { type: 'select', option: 'B' })).toThrow(/already answered/);
    expect(() => applyPracticeEvent(answered, { type: 'submit' })).toThrow(/already answered/);
  });
});

describe('navigation', () => {
  it('moves with next and previous, skipping is allowed', () => {
    let state = applyPracticeEvent(fresh(), { type: 'next' });
    expect(state.currentIndex).toBe(1);
    expect(state.answers).toEqual({});
    state = applyPracticeEvent(state, { type: 'previous' });
    expect(state.currentIndex).toBe(0);
  });

  it('jumps straight to any question from the palette', () => {
    expect(applyPracticeEvent(fresh(), { type: 'go_to', index: 2 }).currentIndex).toBe(2);
  });

  it('drops an unsubmitted selection when moving away', () => {
    let state = applyPracticeEvent(fresh(), { type: 'select', option: 'B' });
    state = applyPracticeEvent(state, { type: 'next' });
    expect(state.pendingSelection).toBeNull();
    state = applyPracticeEvent(state, { type: 'previous' });
    expect(state.pendingSelection).toBeNull();
    expect(state.answers).toEqual({});
  });

  it('keeps earlier answers when coming back to them', () => {
    let state = answer(fresh(), 'A');
    state = applyPracticeEvent(state, { type: 'next' });
    state = applyPracticeEvent(state, { type: 'previous' });
    expect(state.answers[10]).toEqual({ selected: 'A', isCorrect: true });
  });

  it('throws when moving past either end, or to an index outside the session', () => {
    expect(() => applyPracticeEvent(fresh(), { type: 'previous' })).toThrow(/first/);
    const last = applyPracticeEvent(fresh(), { type: 'go_to', index: 2 });
    expect(() => applyPracticeEvent(last, { type: 'next' })).toThrow(/last/);
    for (const index of [-1, 3, 1.5]) {
      expect(() => applyPracticeEvent(fresh(), { type: 'go_to', index })).toThrow(/index/);
    }
  });
});

describe('finish', () => {
  it('ends the session, after which nothing else is accepted', () => {
    const finished = applyPracticeEvent(answer(fresh(), 'A'), { type: 'finish' });
    expect(finished.finished).toBe(true);
    for (const event of [
      { type: 'next' as const },
      { type: 'select' as const, option: 'A' as const },
      { type: 'go_to' as const, index: 1 },
    ]) {
      expect(() => applyPracticeEvent(finished, event)).toThrow(/finished/);
    }
  });

  it('is idempotent, like the mock timer expiring twice at the boundary', () => {
    const finished = applyPracticeEvent(fresh(), { type: 'finish' });
    expect(applyPracticeEvent(finished, { type: 'finish' })).toBe(finished);
  });
});

describe('practiceSummary', () => {
  it('counts answered, correct and unanswered questions', () => {
    let state = answer(fresh(), 'A'); // correct
    state = applyPracticeEvent(state, { type: 'next' });
    state = answer(state, 'B'); // wrong (correct is C)
    expect(practiceSummary(state)).toEqual({ total: 3, answered: 2, correct: 1, unanswered: 1 });
  });

  it('reports everything unanswered at the start', () => {
    expect(practiceSummary(fresh())).toEqual({ total: 3, answered: 0, correct: 0, unanswered: 3 });
  });
});
