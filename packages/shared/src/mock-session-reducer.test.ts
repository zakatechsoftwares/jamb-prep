import { describe, expect, it } from 'vitest';
import { applyMockSessionEvent, initMockSession, type MockSessionState } from './mock-session-reducer';

const ITEM_IDS = [10, 11, 12];

function fresh(): MockSessionState {
  return initMockSession(ITEM_IDS);
}

describe('initMockSession', () => {
  it('starts on the first item, everything unanswered and unflagged, not expired', () => {
    const state = fresh();
    expect(state).toEqual({
      itemIds: ITEM_IDS,
      currentItemId: 10,
      expired: false,
      progress: {
        10: { answered: false, flagged: false, selectedOption: null },
        11: { answered: false, flagged: false, selectedOption: null },
        12: { answered: false, flagged: false, selectedOption: null },
      },
    });
  });

  it('throws for an empty item list', () => {
    expect(() => initMockSession([])).toThrow(/itemIds/);
  });
});

describe('navigate', () => {
  it('moves to any item, regardless of order — free navigation', () => {
    const state = applyMockSessionEvent(fresh(), { type: 'navigate', itemId: 12 });
    expect(state.currentItemId).toBe(12);
  });

  it('moving backward to an earlier item works the same as moving forward', () => {
    let state = fresh();
    state = applyMockSessionEvent(state, { type: 'navigate', itemId: 12 });
    state = applyMockSessionEvent(state, { type: 'navigate', itemId: 10 });
    expect(state.currentItemId).toBe(10);
  });

  it('throws for an item id outside this session', () => {
    expect(() => applyMockSessionEvent(fresh(), { type: 'navigate', itemId: 999 })).toThrow(/itemId/);
  });

  it('throws once the session has expired', () => {
    const expired = applyMockSessionEvent(fresh(), { type: 'expire' });
    expect(() => applyMockSessionEvent(expired, { type: 'navigate', itemId: 11 })).toThrow(/expired/);
  });
});

describe('select_option', () => {
  it('records the answer and marks the item answered', () => {
    const state = applyMockSessionEvent(fresh(), {
      type: 'select_option',
      itemId: 10,
      option: 'B',
    });
    expect(state.progress[10]).toEqual({ answered: true, flagged: false, selectedOption: 'B' });
  });

  it('changing an answer overwrites the previous selection, not a second record', () => {
    let state = fresh();
    state = applyMockSessionEvent(state, { type: 'select_option', itemId: 10, option: 'A' });
    state = applyMockSessionEvent(state, { type: 'select_option', itemId: 10, option: 'C' });
    expect(state.progress[10]).toEqual({ answered: true, flagged: false, selectedOption: 'C' });
  });

  it('DECISION: answering a flagged item keeps the flag — answered and flagged are independent, not mutually exclusive', () => {
    let state = fresh();
    state = applyMockSessionEvent(state, { type: 'toggle_flag', itemId: 10 });
    state = applyMockSessionEvent(state, { type: 'select_option', itemId: 10, option: 'A' });
    expect(state.progress[10]).toEqual({ answered: true, flagged: true, selectedOption: 'A' });
  });

  it('does not affect any other item', () => {
    const state = applyMockSessionEvent(fresh(), {
      type: 'select_option',
      itemId: 10,
      option: 'B',
    });
    expect(state.progress[11]).toEqual({ answered: false, flagged: false, selectedOption: null });
  });

  it('throws for an item id outside this session', () => {
    expect(() =>
      applyMockSessionEvent(fresh(), { type: 'select_option', itemId: 999, option: 'A' }),
    ).toThrow(/itemId/);
  });

  it('throws once the session has expired', () => {
    const expired = applyMockSessionEvent(fresh(), { type: 'expire' });
    expect(() =>
      applyMockSessionEvent(expired, { type: 'select_option', itemId: 10, option: 'A' }),
    ).toThrow(/expired/);
  });
});

describe('toggle_flag', () => {
  it('flags an unflagged item', () => {
    const state = applyMockSessionEvent(fresh(), { type: 'toggle_flag', itemId: 10 });
    expect(state.progress[10]!.flagged).toBe(true);
  });

  it('unflags a flagged item', () => {
    let state = fresh();
    state = applyMockSessionEvent(state, { type: 'toggle_flag', itemId: 10 });
    state = applyMockSessionEvent(state, { type: 'toggle_flag', itemId: 10 });
    expect(state.progress[10]!.flagged).toBe(false);
  });

  it('does not change whether the item is answered', () => {
    let state = fresh();
    state = applyMockSessionEvent(state, { type: 'select_option', itemId: 10, option: 'A' });
    state = applyMockSessionEvent(state, { type: 'toggle_flag', itemId: 10 });
    expect(state.progress[10]).toEqual({ answered: true, flagged: true, selectedOption: 'A' });
  });

  it('throws for an item id outside this session', () => {
    expect(() => applyMockSessionEvent(fresh(), { type: 'toggle_flag', itemId: 999 })).toThrow(
      /itemId/,
    );
  });

  it('throws once the session has expired', () => {
    const expired = applyMockSessionEvent(fresh(), { type: 'expire' });
    expect(() => applyMockSessionEvent(expired, { type: 'toggle_flag', itemId: 10 })).toThrow(
      /expired/,
    );
  });
});

describe('expire', () => {
  it('marks the session expired without touching any progress', () => {
    let state = fresh();
    state = applyMockSessionEvent(state, { type: 'select_option', itemId: 10, option: 'A' });
    state = applyMockSessionEvent(state, { type: 'expire' });
    expect(state.expired).toBe(true);
    expect(state.progress[10]).toEqual({ answered: true, flagged: false, selectedOption: 'A' });
  });

  it('DECISION: is idempotent, not a throw, since a timer check firing more than once near the boundary is expected, unlike every other event after expiry', () => {
    let state = fresh();
    state = applyMockSessionEvent(state, { type: 'expire' });
    expect(() => applyMockSessionEvent(state, { type: 'expire' })).not.toThrow();
    expect(applyMockSessionEvent(state, { type: 'expire' }).expired).toBe(true);
  });
});
