import type { OptionLabel, ReviewAction } from '@jamb/shared';

/**
 * Maps a raw key to what it means for the review flow, per plan 7.9:
 * "A–D to select, 1–4 for actions, Enter to confirm, Esc to cancel." Pure
 * and DOM-free — no `KeyboardEvent`, no `document.activeElement` — so it
 * is testable without rendering anything. Deciding *when* to consult this
 * (skipping it while a text field has focus, for instance) is the
 * component layer's job, not this function's.
 */
export type KeyboardMode = 'solving' | 'deciding' | 'choosingReason' | 'editing';

export type KeyboardIntent =
  | { type: 'selectOption'; option: OptionLabel }
  | { type: 'decide'; action: ReviewAction }
  | { type: 'confirm' }
  | { type: 'cancel' };

const OPTION_KEYS: Record<string, OptionLabel> = { A: 'A', B: 'B', C: 'C', D: 'D' };

// Plan 7.9's action order: Approve, Edit and approve, Reject with reason,
// Escalate to moderator — 1 through 4, in that order.
const ACTION_KEYS: Record<string, ReviewAction> = {
  '1': 'approve',
  '2': 'edit_and_approve',
  '3': 'reject',
  '4': 'escalate',
};

export function resolveKeyboardIntent(key: string, mode: KeyboardMode): KeyboardIntent | null {
  switch (mode) {
    case 'solving': {
      const option = OPTION_KEYS[key.toUpperCase()];
      if (option) {
        return { type: 'selectOption', option };
      }
      if (key === 'Enter') {
        return { type: 'confirm' };
      }
      return null;
    }

    case 'deciding': {
      const action = ACTION_KEYS[key];
      return action ? { type: 'decide', action } : null;
    }

    case 'choosingReason':
      return key === 'Escape' ? { type: 'cancel' } : null;

    case 'editing':
      if (key === 'Escape') {
        return { type: 'cancel' };
      }
      if (key === 'Enter') {
        return { type: 'confirm' };
      }
      return null;
  }
}
