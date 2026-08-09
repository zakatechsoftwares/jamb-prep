import type { OptionLabel, RevealResult, ReviewQueueItem } from '@jamb/shared';

/**
 * A single-item review, client-side (plan 7.9). Pure and dependency-free —
 * no fetch, no DOM, no clock — so every transition is testable without
 * rendering anything. The orchestrating hook (`useReviewFlow`) owns all
 * I/O and dispatches the event that reports its outcome; this module only
 * ever decides what the next screen is.
 *
 * `pending` is orthogonal to `status`: it means "a request for this step is
 * in flight," not "which step." Modeling it as a separate flag rather than
 * a parallel set of `submittingX` statuses is what keeps this a state
 * machine over *screens*, not over *screens times request phases*.
 */
export interface ItemEditDraft {
  stem: string;
  options: Record<OptionLabel, string>;
  key: OptionLabel;
  explanation: string;
}

/** Unlike `Partial<ItemEditDraft>`, `options` here is itself partial too —
 * editing one distractor must not require restating the other three. */
export interface ItemEditDraftPatch {
  stem?: string;
  options?: Partial<Record<OptionLabel, string>>;
  key?: OptionLabel;
  explanation?: string;
}

interface ReviewFlowStateCommon {
  pending: boolean;
}

export type ReviewFlowState =
  | (ReviewFlowStateCommon & { status: 'loading' })
  | (ReviewFlowStateCommon & { status: 'empty' })
  | (ReviewFlowStateCommon & {
      status: 'solving';
      item: ReviewQueueItem;
      selected: OptionLabel | null;
      /**
       * A blind answer for a high-tier item, recorded locally while offline
       * (8.3) and not yet uploaded — reveal stays online-only (7.10's
       * anti-anchoring control lives at the server, not in this reducer),
       * so there is nowhere to advance to until reconnection resolves this
       * via the ordinary `itemRevealed` or `requestFailed` events.
       */
      queued: boolean;
    })
  | (ReviewFlowStateCommon & { status: 'deciding'; item: ReviewQueueItem; reveal: RevealResult })
  | (ReviewFlowStateCommon & {
      status: 'choosingReason';
      item: ReviewQueueItem;
      reveal: RevealResult;
    })
  | (ReviewFlowStateCommon & {
      status: 'editing';
      item: ReviewQueueItem;
      reveal: RevealResult;
      draft: ItemEditDraft;
    })
  | (ReviewFlowStateCommon & { status: 'error'; message: string });

export type ReviewFlowEvent =
  | { type: 'requestStarted' }
  | { type: 'queueEmpty' }
  | { type: 'itemNeedsSolve'; item: ReviewQueueItem }
  | { type: 'itemRevealed'; item: ReviewQueueItem; reveal: RevealResult }
  | { type: 'selectOption'; option: OptionLabel }
  | { type: 'solveSubmitted' }
  | { type: 'blindAnswerQueued' }
  | { type: 'startReject' }
  | { type: 'startEdit' }
  | { type: 'updateDraft'; patch: ItemEditDraftPatch }
  | { type: 'cancel' }
  | { type: 'decisionSubmitted' }
  | { type: 'requestFailed'; message: string };

export const INITIAL_REVIEW_FLOW_STATE: ReviewFlowState = { status: 'loading', pending: false };

function draftFrom(item: ReviewQueueItem, reveal: RevealResult): ItemEditDraft {
  return {
    stem: item.stem,
    options: Object.fromEntries(
      item.options.map((option) => [option.label, option.text]),
    ) as Record<OptionLabel, string>,
    key: reveal.correctOption,
    explanation: reveal.explanation,
  };
}

export function reduceReviewFlow(state: ReviewFlowState, event: ReviewFlowEvent): ReviewFlowState {
  switch (event.type) {
    case 'requestStarted':
      return { status: 'loading', pending: false };

    case 'queueEmpty':
      return { status: 'empty', pending: false };

    case 'itemNeedsSolve':
      return { status: 'solving', pending: false, item: event.item, selected: null, queued: false };

    case 'itemRevealed':
      return { status: 'deciding', pending: false, item: event.item, reveal: event.reveal };

    case 'selectOption':
      if (state.status !== 'solving') {
        throw new Error(
          `reduceReviewFlow: selectOption is only valid while solving, not ${state.status}`,
        );
      }
      if (state.queued) {
        throw new Error(
          'reduceReviewFlow: selectOption is not valid once the blind answer has already been queued for upload',
        );
      }
      return { ...state, selected: event.option };

    case 'solveSubmitted':
      if (state.status !== 'solving') {
        throw new Error(
          `reduceReviewFlow: solveSubmitted is only valid while solving, not ${state.status}`,
        );
      }
      if (state.selected === null) {
        throw new Error(
          'reduceReviewFlow: solveSubmitted requires an option to already be selected',
        );
      }
      if (state.queued) {
        throw new Error(
          'reduceReviewFlow: solveSubmitted is not valid once the blind answer has already been queued for upload',
        );
      }
      return { ...state, pending: true };

    case 'blindAnswerQueued':
      if (state.status !== 'solving') {
        throw new Error(
          `reduceReviewFlow: blindAnswerQueued is only valid while solving, not ${state.status}`,
        );
      }
      return { ...state, pending: false, queued: true };

    case 'startReject':
      if (state.status !== 'deciding') {
        throw new Error(
          `reduceReviewFlow: startReject is only valid while deciding, not ${state.status}`,
        );
      }
      return { status: 'choosingReason', pending: false, item: state.item, reveal: state.reveal };

    case 'startEdit':
      if (state.status !== 'deciding') {
        throw new Error(
          `reduceReviewFlow: startEdit is only valid while deciding, not ${state.status}`,
        );
      }
      return {
        status: 'editing',
        pending: false,
        item: state.item,
        reveal: state.reveal,
        draft: draftFrom(state.item, state.reveal),
      };

    case 'updateDraft':
      if (state.status !== 'editing') {
        throw new Error(
          `reduceReviewFlow: updateDraft is only valid while editing, not ${state.status}`,
        );
      }
      return {
        ...state,
        draft: {
          ...state.draft,
          ...event.patch,
          options: { ...state.draft.options, ...event.patch.options },
        },
      };

    case 'cancel':
      if (state.status !== 'choosingReason' && state.status !== 'editing') {
        throw new Error(
          `reduceReviewFlow: cancel is only valid while choosingReason or editing, not ${state.status}`,
        );
      }
      return { status: 'deciding', pending: false, item: state.item, reveal: state.reveal };

    case 'decisionSubmitted':
      if (
        state.status !== 'deciding' &&
        state.status !== 'choosingReason' &&
        state.status !== 'editing'
      ) {
        throw new Error(`reduceReviewFlow: decisionSubmitted is not valid from ${state.status}`);
      }
      return { ...state, pending: true };

    case 'requestFailed':
      return { status: 'error', pending: false, message: event.message };
  }
}
