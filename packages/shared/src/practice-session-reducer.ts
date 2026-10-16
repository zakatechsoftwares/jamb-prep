import { OPTION_LABELS, type OptionLabel } from './item-lifecycle';

/**
 * The candidate's Practice-mode state (plan 6.1: one subject, immediate
 * feedback, no timer) — pure, no I/O, styled after `mock-session-reducer`.
 * The mobile hook writes every submitted answer to local storage itself;
 * this module only decides what the resulting in-memory state is.
 *
 * Decisions, confirmed with the user:
 * - Skipping is allowed: next/previous/go_to work whether or not the
 *   current question was answered, and a skipped question can be returned
 *   to any time before finishing.
 * - An answered question is review-only. Its recorded answer and
 *   explanation show when revisited, but it can't be re-answered — every
 *   submitted answer is already an immutable local attempt (rule 2), and a
 *   second answer would make the score ambiguous.
 * - The session ends only through an explicit `finish` (never by reaching
 *   the last question), since skipped questions may still be waiting.
 */

export interface PracticeItemRef {
  itemId: number;
  correctOption: OptionLabel;
}

export interface PracticeAnswer {
  selected: OptionLabel;
  isCorrect: boolean;
}

export interface PracticeSessionState {
  /** Fixed for the life of the session, in serving order. */
  items: PracticeItemRef[];
  currentIndex: number;
  /** A choice on the current, unanswered question that hasn't been submitted yet. */
  pendingSelection: OptionLabel | null;
  /** Submitted answers, by item id. Present means answered and revealed. */
  answers: Record<number, PracticeAnswer>;
  finished: boolean;
}

export type PracticeEvent =
  | { type: 'select'; option: OptionLabel }
  | { type: 'submit' }
  | { type: 'next' }
  | { type: 'previous' }
  | { type: 'go_to'; index: number }
  | { type: 'finish' };

export interface PracticeSummary {
  total: number;
  answered: number;
  correct: number;
  unanswered: number;
}

export function initPracticeSession(items: readonly PracticeItemRef[]): PracticeSessionState {
  if (items.length === 0) {
    throw new Error('initPracticeSession: items must not be empty');
  }

  const seen = new Set<number>();
  for (const item of items) {
    if (seen.has(item.itemId)) {
      throw new Error(`initPracticeSession: item ${item.itemId} appears twice`);
    }
    seen.add(item.itemId);
    if (!(OPTION_LABELS as readonly string[]).includes(item.correctOption)) {
      throw new Error(
        `initPracticeSession: item ${item.itemId} has correctOption ${JSON.stringify(item.correctOption)}, not one of ${OPTION_LABELS.join(', ')}`,
      );
    }
  }

  return { items: [...items], currentIndex: 0, pendingSelection: null, answers: {}, finished: false };
}

function currentItem(state: PracticeSessionState): PracticeItemRef {
  return state.items[state.currentIndex]!;
}

function moveTo(state: PracticeSessionState, index: number): PracticeSessionState {
  // Leaving a question drops any choice that was never submitted.
  return { ...state, currentIndex: index, pendingSelection: null };
}

/**
 * Applies one event. Every event but `finish` throws once the session has
 * finished; `finish` itself is idempotent.
 */
export function applyPracticeEvent(
  state: PracticeSessionState,
  event: PracticeEvent,
): PracticeSessionState {
  if (event.type === 'finish') {
    return state.finished ? state : { ...state, finished: true, pendingSelection: null };
  }

  if (state.finished) {
    throw new Error(`applyPracticeEvent: ${event.type} after the session has finished`);
  }

  switch (event.type) {
    case 'select': {
      const item = currentItem(state);
      if (item.itemId in state.answers) {
        throw new Error(`applyPracticeEvent: item ${item.itemId} is already answered and review-only`);
      }
      return { ...state, pendingSelection: event.option };
    }

    case 'submit': {
      const item = currentItem(state);
      if (item.itemId in state.answers) {
        throw new Error(`applyPracticeEvent: item ${item.itemId} is already answered and review-only`);
      }
      if (state.pendingSelection === null) {
        throw new Error('applyPracticeEvent: select an option before submitting');
      }
      return {
        ...state,
        pendingSelection: null,
        answers: {
          ...state.answers,
          [item.itemId]: {
            selected: state.pendingSelection,
            isCorrect: state.pendingSelection === item.correctOption,
          },
        },
      };
    }

    case 'next': {
      if (state.currentIndex >= state.items.length - 1) {
        throw new Error('applyPracticeEvent: already on the last question');
      }
      return moveTo(state, state.currentIndex + 1);
    }

    case 'previous': {
      if (state.currentIndex === 0) {
        throw new Error('applyPracticeEvent: already on the first question');
      }
      return moveTo(state, state.currentIndex - 1);
    }

    case 'go_to': {
      if (!Number.isInteger(event.index) || event.index < 0 || event.index >= state.items.length) {
        throw new Error(
          `applyPracticeEvent: index ${event.index} is outside this session (0-${state.items.length - 1})`,
        );
      }
      return moveTo(state, event.index);
    }
  }
}

export function practiceSummary(state: PracticeSessionState): PracticeSummary {
  const answers = state.items
    .map((item) => state.answers[item.itemId])
    .filter((answer): answer is PracticeAnswer => answer !== undefined);
  const correct = answers.filter((answer) => answer.isCorrect).length;
  return {
    total: state.items.length,
    answered: answers.length,
    correct,
    unanswered: state.items.length - answers.length,
  };
}
