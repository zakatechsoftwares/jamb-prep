import type { OptionLabel } from './item-lifecycle';

/**
 * The candidate's exam-taking state (plan 3, canonical session 12) — pure,
 * no I/O, no clock, styled after `apps/admin/src/lib/review-flow-reducer.ts`.
 * The mobile app's persistence layer (not built yet — Phase 2) is
 * responsible for writing every event's effect to local SQLite before
 * anything here is trusted; this module only ever decides what the
 * resulting in-memory state is.
 *
 * DECISION: `answered` and `flagged` are independent booleans, not a single
 * exclusive palette status. A candidate answering an item they'd already
 * flagged for review — or flagging one they've already answered, to double
 * check later — is ordinary exam behaviour; collapsing them into one
 * mutually-exclusive state would make that combination unrepresentable.
 */
export interface ItemProgress {
  answered: boolean;
  flagged: boolean;
  selectedOption: OptionLabel | null;
}

export interface MockSessionState {
  /** Fixed for the life of the session — the full 180-item set, in a stable but not enforced order. */
  itemIds: number[];
  currentItemId: number;
  progress: Record<number, ItemProgress>;
  expired: boolean;
}

export type MockSessionEvent =
  | { type: 'navigate'; itemId: number }
  | { type: 'select_option'; itemId: number; option: OptionLabel }
  | { type: 'toggle_flag'; itemId: number }
  | { type: 'expire' };

export function initMockSession(itemIds: number[]): MockSessionState {
  if (itemIds.length === 0) {
    throw new Error('initMockSession: itemIds must not be empty');
  }

  const progress: Record<number, ItemProgress> = {};
  for (const itemId of itemIds) {
    progress[itemId] = { answered: false, flagged: false, selectedOption: null };
  }

  return { itemIds, currentItemId: itemIds[0]!, progress, expired: false };
}

function assertKnownItem(state: MockSessionState, itemId: number, callerName: string): void {
  if (!(itemId in state.progress)) {
    throw new Error(`${callerName}: itemId ${itemId} is not part of this session`);
  }
}

function assertNotExpired(state: MockSessionState, callerName: string): void {
  if (state.expired) {
    throw new Error(`${callerName}: this session has already expired`);
  }
}

/**
 * Applies one event. Every event but `expire` throws once the session has
 * expired — there is nothing left to navigate to, answer, or flag once the
 * mock is over. `expire` itself is idempotent rather than a throw: a timer
 * check firing more than once right at the boundary is expected, unlike
 * every other event after expiry, which represents a client that kept
 * accepting input it should have stopped accepting.
 */
export function applyMockSessionEvent(
  state: MockSessionState,
  event: MockSessionEvent,
): MockSessionState {
  if (event.type === 'expire') {
    return state.expired ? state : { ...state, expired: true };
  }

  assertNotExpired(state, 'applyMockSessionEvent');

  switch (event.type) {
    case 'navigate': {
      assertKnownItem(state, event.itemId, 'applyMockSessionEvent');
      return { ...state, currentItemId: event.itemId };
    }

    case 'select_option': {
      assertKnownItem(state, event.itemId, 'applyMockSessionEvent');
      return {
        ...state,
        progress: {
          ...state.progress,
          [event.itemId]: {
            ...state.progress[event.itemId]!,
            answered: true,
            selectedOption: event.option,
          },
        },
      };
    }

    case 'toggle_flag': {
      assertKnownItem(state, event.itemId, 'applyMockSessionEvent');
      const current = state.progress[event.itemId]!;
      return {
        ...state,
        progress: { ...state.progress, [event.itemId]: { ...current, flagged: !current.flagged } },
      };
    }
  }
}
