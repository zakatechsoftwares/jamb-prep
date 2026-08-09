import { describe, expect, it } from 'vitest';
import { resolveKeyboardIntent } from './keyboard-shortcuts';

describe('resolveKeyboardIntent — solving', () => {
  it.each([
    ['a', 'A'],
    ['A', 'A'],
    ['b', 'B'],
    ['B', 'B'],
    ['c', 'C'],
    ['d', 'D'],
  ] as const)('maps key %s to selecting option %s', (key, option) => {
    expect(resolveKeyboardIntent(key, 'solving')).toEqual({ type: 'selectOption', option });
  });

  it('maps Enter to confirm', () => {
    expect(resolveKeyboardIntent('Enter', 'solving')).toEqual({ type: 'confirm' });
  });

  it('ignores keys outside A-D and Enter', () => {
    expect(resolveKeyboardIntent('e', 'solving')).toBeNull();
    expect(resolveKeyboardIntent('1', 'solving')).toBeNull();
    expect(resolveKeyboardIntent('Escape', 'solving')).toBeNull();
  });
});

describe('resolveKeyboardIntent — deciding', () => {
  it('maps 1 to approve', () => {
    expect(resolveKeyboardIntent('1', 'deciding')).toEqual({ type: 'decide', action: 'approve' });
  });

  it('maps 2 to edit_and_approve', () => {
    expect(resolveKeyboardIntent('2', 'deciding')).toEqual({
      type: 'decide',
      action: 'edit_and_approve',
    });
  });

  it('maps 3 to reject', () => {
    expect(resolveKeyboardIntent('3', 'deciding')).toEqual({ type: 'decide', action: 'reject' });
  });

  it('maps 4 to escalate', () => {
    expect(resolveKeyboardIntent('4', 'deciding')).toEqual({ type: 'decide', action: 'escalate' });
  });

  it('ignores A-D, Enter and Esc — there is nothing to select or cancel here', () => {
    expect(resolveKeyboardIntent('A', 'deciding')).toBeNull();
    expect(resolveKeyboardIntent('Enter', 'deciding')).toBeNull();
    expect(resolveKeyboardIntent('Escape', 'deciding')).toBeNull();
    expect(resolveKeyboardIntent('5', 'deciding')).toBeNull();
  });
});

describe('resolveKeyboardIntent — choosingReason', () => {
  it('maps Escape to cancel', () => {
    expect(resolveKeyboardIntent('Escape', 'choosingReason')).toEqual({ type: 'cancel' });
  });

  it('ignores everything else — reasons are chosen by tap, not by key', () => {
    expect(resolveKeyboardIntent('1', 'choosingReason')).toBeNull();
    expect(resolveKeyboardIntent('A', 'choosingReason')).toBeNull();
    expect(resolveKeyboardIntent('Enter', 'choosingReason')).toBeNull();
  });
});

describe('resolveKeyboardIntent — editing', () => {
  it('maps Escape to cancel', () => {
    expect(resolveKeyboardIntent('Escape', 'editing')).toEqual({ type: 'cancel' });
  });

  it('maps Enter to confirm', () => {
    expect(resolveKeyboardIntent('Enter', 'editing')).toEqual({ type: 'confirm' });
  });

  it('ignores A-D and 1-4 — those are not meaningful while editing free text', () => {
    expect(resolveKeyboardIntent('A', 'editing')).toBeNull();
    expect(resolveKeyboardIntent('1', 'editing')).toBeNull();
  });
});
