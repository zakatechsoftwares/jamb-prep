import { describe, expect, it } from 'vitest';
import { scoresAgreement, type GoldReference, type GoldScoringInput } from './gold-scoring-policy';

const APPROVE_REFERENCE: GoldReference = {
  referenceDecision: 'approve',
  referenceKey: 'A',
};

const REJECT_REFERENCE: GoldReference = {
  referenceDecision: 'reject',
  referenceKey: 'A',
};

const ESCALATE_REFERENCE: GoldReference = {
  referenceDecision: 'escalate',
  referenceKey: 'A',
};

describe('scoresAgreement', () => {
  it('agrees when a bare approve matches an approve reference', () => {
    const actual: GoldScoringInput = { action: 'approve' };
    expect(scoresAgreement(APPROVE_REFERENCE, actual)).toBe(true);
  });

  it('agrees when a bare reject matches a reject reference', () => {
    const actual: GoldScoringInput = { action: 'reject' };
    expect(scoresAgreement(REJECT_REFERENCE, actual)).toBe(true);
  });

  it('agrees when escalate matches an escalate reference', () => {
    const actual: GoldScoringInput = { action: 'escalate' };
    expect(scoresAgreement(ESCALATE_REFERENCE, actual)).toBe(true);
  });

  it('disagrees when the reviewer approves an item whose reference says reject', () => {
    const actual: GoldScoringInput = { action: 'approve' };
    expect(scoresAgreement(REJECT_REFERENCE, actual)).toBe(false);
  });

  it('disagrees when the reviewer rejects an item whose reference says approve', () => {
    const actual: GoldScoringInput = { action: 'reject' };
    expect(scoresAgreement(APPROVE_REFERENCE, actual)).toBe(false);
  });

  it('disagrees when the reviewer escalates an item whose reference is a clean approve', () => {
    const actual: GoldScoringInput = { action: 'escalate' };
    expect(scoresAgreement(APPROVE_REFERENCE, actual)).toBe(false);
  });

  it('treats edit_and_approve as an approval, agreeing with an approve reference', () => {
    const actual: GoldScoringInput = { action: 'edit_and_approve' };
    expect(scoresAgreement(APPROVE_REFERENCE, actual)).toBe(true);
  });

  it('edit_and_approve still disagrees with a reject reference — editing is not what the gold item measures', () => {
    const actual: GoldScoringInput = { action: 'edit_and_approve', editedKey: 'A' };
    expect(scoresAgreement(REJECT_REFERENCE, actual)).toBe(false);
  });

  it('agrees on edit_and_approve when the corrected key matches the reference key', () => {
    const actual: GoldScoringInput = { action: 'edit_and_approve', editedKey: 'A' };
    expect(scoresAgreement(APPROVE_REFERENCE, actual)).toBe(true);
  });

  it('disagrees on edit_and_approve when the corrected key does not match the reference key', () => {
    const actual: GoldScoringInput = { action: 'edit_and_approve', editedKey: 'B' };
    expect(scoresAgreement(APPROVE_REFERENCE, actual)).toBe(false);
  });

  it('agrees on edit_and_approve when no key was actually changed — the base action still matches', () => {
    // The reviewer edited the explanation only, not the key; editedKey is
    // absent because parseDecisionInput's edits.key is optional.
    const actual: GoldScoringInput = { action: 'edit_and_approve' };
    expect(scoresAgreement(APPROVE_REFERENCE, actual)).toBe(true);
  });
});
