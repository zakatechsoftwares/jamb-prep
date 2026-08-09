'use client';

import { useEffect } from 'react';
import { resolveKeyboardIntent, type KeyboardMode } from '../lib/keyboard-shortcuts';
import type { useReviewFlow } from './useReviewFlow';

function modeFor(status: string): KeyboardMode | null {
  switch (status) {
    case 'solving':
      return 'solving';
    case 'deciding':
      return 'deciding';
    case 'choosingReason':
      return 'choosingReason';
    case 'editing':
      return 'editing';
    default:
      return null;
  }
}

/**
 * Wires `resolveKeyboardIntent` to the real DOM: "A–D to select, 1–4 for
 * actions, Enter to confirm, Esc to cancel" (plan 7.9). The one thing the
 * pure mapping function deliberately does not know about — whether the
 * keypress landed inside a text field — is decided here: A-D and 1-4 are
 * suppressed while an `<input>`/`<textarea>` has focus (typing "3" into
 * the stem must not start a rejection), but Escape always still cancels.
 */
export function useReviewFlowKeyboard(flow: ReturnType<typeof useReviewFlow>): void {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      const mode = modeFor(flow.state.status);
      if (!mode) {
        return;
      }

      const target = event.target as HTMLElement | null;
      const isTextEntry = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA';
      if (isTextEntry && event.key !== 'Escape') {
        return;
      }

      const intent = resolveKeyboardIntent(event.key, mode);
      if (!intent) {
        return;
      }

      event.preventDefault();

      switch (intent.type) {
        case 'selectOption':
          flow.selectOption(intent.option);
          break;

        case 'decide':
          if (intent.action === 'approve') {
            void flow.approve();
          } else if (intent.action === 'escalate') {
            void flow.escalate();
          } else if (intent.action === 'reject') {
            flow.startReject();
          } else {
            flow.startEdit();
          }
          break;

        case 'confirm':
          if (flow.state.status === 'solving') {
            void flow.submitSolve();
          } else if (flow.state.status === 'editing') {
            void flow.confirmEdit();
          }
          break;

        case 'cancel':
          flow.cancel();
          break;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [flow]);
}
