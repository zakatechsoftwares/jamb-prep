import { describe, expect, it } from 'vitest';
import type { ReviewQueueItem, RevealResult } from '@jamb/shared';
import {
  INITIAL_REVIEW_FLOW_STATE,
  reduceReviewFlow,
  type ReviewFlowState,
} from './review-flow-reducer';

const ITEM: ReviewQueueItem = {
  itemId: 42,
  subjectId: 1,
  objectiveId: 7,
  stem: 'What is the SI unit of force?',
  options: [
    { label: 'A', text: 'newton' },
    { label: 'B', text: 'joule' },
    { label: 'C', text: 'watt' },
    { label: 'D', text: 'pascal' },
  ],
  cognitiveLevel: 'recall',
  independentSolveVerdict: 'agreed',
  claimExpiresAt: new Date('2026-08-09T10:00:00.000Z'),
  diagram: null,
};

const REVEAL: RevealResult = {
  correctOption: 'A',
  explanation: "Force is measured in newtons, per Newton's second law.",
  verdict: 'agreed',
  agreesWithKey: true,
};

const SOLVING: ReviewFlowState = {
  status: 'solving',
  pending: false,
  item: ITEM,
  selected: null,
  queued: false,
};
const DECIDING: ReviewFlowState = {
  status: 'deciding',
  pending: false,
  item: ITEM,
  reveal: REVEAL,
};

describe('INITIAL_REVIEW_FLOW_STATE', () => {
  it('starts loading and not pending', () => {
    expect(INITIAL_REVIEW_FLOW_STATE).toEqual({ status: 'loading', pending: false });
  });
});

describe('reduceReviewFlow', () => {
  it('is pure: it does not mutate the state object it was given', () => {
    const before = { ...SOLVING };
    reduceReviewFlow(SOLVING, { type: 'selectOption', option: 'B' });
    expect(SOLVING).toEqual(before);
  });

  describe('requestStarted', () => {
    it('moves to loading from anywhere, clearing pending', () => {
      const result = reduceReviewFlow(
        { status: 'error', pending: false, message: 'boom' },
        { type: 'requestStarted' },
      );
      expect(result).toEqual({ status: 'loading', pending: false });
    });
  });

  describe('queueEmpty', () => {
    it('moves to empty', () => {
      expect(reduceReviewFlow(INITIAL_REVIEW_FLOW_STATE, { type: 'queueEmpty' })).toEqual({
        status: 'empty',
        pending: false,
      });
    });
  });

  describe('itemNeedsSolve', () => {
    it('moves to solving with nothing selected yet', () => {
      const result = reduceReviewFlow(INITIAL_REVIEW_FLOW_STATE, {
        type: 'itemNeedsSolve',
        item: ITEM,
      });
      expect(result).toEqual({
        status: 'solving',
        pending: false,
        item: ITEM,
        selected: null,
        queued: false,
      });
    });
  });

  describe('itemRevealed', () => {
    it('moves to deciding, whether reached directly or after solving', () => {
      const fromLoading = reduceReviewFlow(INITIAL_REVIEW_FLOW_STATE, {
        type: 'itemRevealed',
        item: ITEM,
        reveal: REVEAL,
      });
      expect(fromLoading).toEqual({
        status: 'deciding',
        pending: false,
        item: ITEM,
        reveal: REVEAL,
      });

      const fromSolving = reduceReviewFlow(SOLVING, {
        type: 'itemRevealed',
        item: ITEM,
        reveal: REVEAL,
      });
      expect(fromSolving).toEqual({
        status: 'deciding',
        pending: false,
        item: ITEM,
        reveal: REVEAL,
      });
    });
  });

  describe('selectOption', () => {
    it('records the selected option while solving', () => {
      const result = reduceReviewFlow(SOLVING, { type: 'selectOption', option: 'C' });
      expect(result).toMatchObject({ status: 'solving', selected: 'C' });
    });

    it('replaces a previous selection rather than accumulating it', () => {
      const once = reduceReviewFlow(SOLVING, { type: 'selectOption', option: 'C' });
      const twice = reduceReviewFlow(once, { type: 'selectOption', option: 'D' });
      expect(twice).toMatchObject({ selected: 'D' });
    });

    it('throws when not solving', () => {
      expect(() => reduceReviewFlow(DECIDING, { type: 'selectOption', option: 'A' })).toThrow(
        /selectOption/,
      );
    });
  });

  describe('solveSubmitted', () => {
    it('sets pending once an option is selected', () => {
      const selected = reduceReviewFlow(SOLVING, { type: 'selectOption', option: 'A' });
      const result = reduceReviewFlow(selected, { type: 'solveSubmitted' });
      expect(result).toMatchObject({ status: 'solving', pending: true, selected: 'A' });
    });

    it('throws when no option has been selected yet', () => {
      expect(() => reduceReviewFlow(SOLVING, { type: 'solveSubmitted' })).toThrow(/selected/i);
    });

    it('throws when not solving', () => {
      expect(() => reduceReviewFlow(DECIDING, { type: 'solveSubmitted' })).toThrow(
        /solveSubmitted/,
      );
    });

    it('throws once the blind answer has already been queued for upload', () => {
      const selected = reduceReviewFlow(SOLVING, { type: 'selectOption', option: 'A' });
      const submitted = reduceReviewFlow(selected, { type: 'solveSubmitted' });
      const queued = reduceReviewFlow(submitted, { type: 'blindAnswerQueued' });
      expect(() => reduceReviewFlow(queued, { type: 'solveSubmitted' })).toThrow(
        /solveSubmitted/,
      );
    });
  });

  describe('blindAnswerQueued', () => {
    // Session 08: a high-tier item's reveal stays online-only, so a blind
    // answer submitted offline has nowhere to advance to yet — the flow
    // rests here, marked queued, until reconnection resolves it via the
    // ordinary itemRevealed or requestFailed events.
    it('moves from a pending solve to solving with queued set, keeping the selection', () => {
      const selected = reduceReviewFlow(SOLVING, { type: 'selectOption', option: 'B' });
      const submitted = reduceReviewFlow(selected, { type: 'solveSubmitted' });

      const result = reduceReviewFlow(submitted, { type: 'blindAnswerQueued' });

      expect(result).toEqual({
        status: 'solving',
        pending: false,
        item: ITEM,
        selected: 'B',
        queued: true,
      });
    });

    it('throws when not solving', () => {
      expect(() => reduceReviewFlow(DECIDING, { type: 'blindAnswerQueued' })).toThrow(
        /blindAnswerQueued/,
      );
    });

    it('a queued solve still resolves normally once reconnection reveals the item', () => {
      const selected = reduceReviewFlow(SOLVING, { type: 'selectOption', option: 'B' });
      const submitted = reduceReviewFlow(selected, { type: 'solveSubmitted' });
      const queued = reduceReviewFlow(submitted, { type: 'blindAnswerQueued' });

      const result = reduceReviewFlow(queued, { type: 'itemRevealed', item: ITEM, reveal: REVEAL });

      expect(result).toEqual({ status: 'deciding', pending: false, item: ITEM, reveal: REVEAL });
    });
  });

  describe('selectOption once queued', () => {
    it('throws, since the answer has already been queued for upload', () => {
      const selected = reduceReviewFlow(SOLVING, { type: 'selectOption', option: 'A' });
      const submitted = reduceReviewFlow(selected, { type: 'solveSubmitted' });
      const queued = reduceReviewFlow(submitted, { type: 'blindAnswerQueued' });

      expect(() => reduceReviewFlow(queued, { type: 'selectOption', option: 'B' })).toThrow(
        /selectOption/,
      );
    });
  });

  describe('startReject', () => {
    it('moves from deciding to choosingReason, carrying the item and reveal forward', () => {
      const result = reduceReviewFlow(DECIDING, { type: 'startReject' });
      expect(result).toEqual({
        status: 'choosingReason',
        pending: false,
        item: ITEM,
        reveal: REVEAL,
      });
    });

    it('throws when not deciding', () => {
      expect(() => reduceReviewFlow(SOLVING, { type: 'startReject' })).toThrow(/startReject/);
    });
  });

  describe('startEdit', () => {
    it('moves from deciding to editing with a draft seeded from the item and the revealed key', () => {
      const result = reduceReviewFlow(DECIDING, { type: 'startEdit' });
      expect(result).toEqual({
        status: 'editing',
        pending: false,
        item: ITEM,
        reveal: REVEAL,
        draft: {
          stem: ITEM.stem,
          options: { A: 'newton', B: 'joule', C: 'watt', D: 'pascal' },
          key: 'A',
          explanation: REVEAL.explanation,
        },
      });
    });

    it('throws when not deciding', () => {
      expect(() => reduceReviewFlow(SOLVING, { type: 'startEdit' })).toThrow(/startEdit/);
    });
  });

  describe('updateDraft', () => {
    const EDITING = reduceReviewFlow(DECIDING, { type: 'startEdit' });

    it('merges a stem-only patch without touching other fields', () => {
      const result = reduceReviewFlow(EDITING, {
        type: 'updateDraft',
        patch: { stem: 'Revised stem' },
      });
      expect(result).toMatchObject({
        status: 'editing',
        draft: { stem: 'Revised stem', explanation: REVEAL.explanation, key: 'A' },
      });
    });

    it('merges a partial options patch into the existing options, leaving the rest untouched', () => {
      const result = reduceReviewFlow(EDITING, {
        type: 'updateDraft',
        patch: { options: { B: 'kilojoule' } },
      });
      expect(result).toMatchObject({
        draft: { options: { A: 'newton', B: 'kilojoule', C: 'watt', D: 'pascal' } },
      });
    });

    it('throws when not editing', () => {
      expect(() =>
        reduceReviewFlow(DECIDING, { type: 'updateDraft', patch: { stem: 'x' } }),
      ).toThrow(/updateDraft/);
    });
  });

  describe('cancel', () => {
    it('returns from choosingReason to deciding', () => {
      const choosing = reduceReviewFlow(DECIDING, { type: 'startReject' });
      expect(reduceReviewFlow(choosing, { type: 'cancel' })).toEqual(DECIDING);
    });

    it('returns from editing to deciding, discarding the draft', () => {
      const editing = reduceReviewFlow(DECIDING, { type: 'startEdit' });
      expect(reduceReviewFlow(editing, { type: 'cancel' })).toEqual(DECIDING);
    });

    it('throws when not choosingReason or editing', () => {
      expect(() => reduceReviewFlow(SOLVING, { type: 'cancel' })).toThrow(/cancel/);
      expect(() => reduceReviewFlow(DECIDING, { type: 'cancel' })).toThrow(/cancel/);
    });
  });

  describe('decisionSubmitted', () => {
    it.each(['deciding', 'choosingReason', 'editing'] as const)(
      'sets pending while staying on %s',
      (status) => {
        const state: ReviewFlowState =
          status === 'deciding'
            ? DECIDING
            : status === 'choosingReason'
              ? reduceReviewFlow(DECIDING, { type: 'startReject' })
              : reduceReviewFlow(DECIDING, { type: 'startEdit' });

        const result = reduceReviewFlow(state, { type: 'decisionSubmitted' });
        expect(result).toMatchObject({ status, pending: true });
      },
    );

    it('throws when not on a decidable step', () => {
      expect(() => reduceReviewFlow(SOLVING, { type: 'decisionSubmitted' })).toThrow(
        /decisionSubmitted/,
      );
      expect(() =>
        reduceReviewFlow(INITIAL_REVIEW_FLOW_STATE, { type: 'decisionSubmitted' }),
      ).toThrow(/decisionSubmitted/);
    });
  });

  describe('requestFailed', () => {
    it('moves to an error state carrying the message, from any state', () => {
      for (const state of [INITIAL_REVIEW_FLOW_STATE, SOLVING, DECIDING]) {
        expect(reduceReviewFlow(state, { type: 'requestFailed', message: 'network down' })).toEqual(
          {
            status: 'error',
            pending: false,
            message: 'network down',
          },
        );
      }
    });
  });
});
