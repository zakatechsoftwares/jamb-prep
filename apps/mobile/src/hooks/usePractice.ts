import { useCallback, useRef, useState } from 'react';
import { computeSessionEndAt, generateSyncId, type OptionLabel } from '@jamb/shared';
import {
  endLocalSession,
  loadActiveExamConfigId,
  loadLocalItems,
  recordLocalProgressEvent,
  startLocalSession,
  type LocalItemForPractice,
} from '../lib/database';
import { syncPendingSessions } from '../lib/sync';

/**
 * Practice mode (plan 6.1: "untimed or lightly timed practice by subject
 * and topic, with immediate feedback and explanation after each item") —
 * genuinely simpler than `useMockSession.ts`'s Mock CBT engine on purpose:
 * one subject, no consolidated timer, no palette, no flags. Walks the
 * downloaded pack's real items one at a time. A `mode: 'practice'` local
 * session still goes through the same `recordLocalProgressEvent`/`sync.ts`
 * pipeline Mock mode uses, unmodified.
 *
 * No countdown is shown or enforced — `PRACTICE_MAX_DURATION_MINUTES` only
 * satisfies `local_sessions.end_at`'s `NOT NULL` column; nothing reads it
 * as a deadline the way Mock mode's timer does.
 */
const PRACTICE_MAX_DURATION_MINUTES = 240;

export type PracticePhase = 'not_started' | 'in_progress' | 'finished';

export interface UsePracticeResult {
  phase: PracticePhase;
  currentItem: LocalItemForPractice | null;
  currentIndex: number;
  totalItems: number;
  selected: OptionLabel | null;
  revealed: boolean;
  correctCount: number;
  /** Null until a subject has been chosen; distinguishes "not started" from "no items were found for that subject." */
  startError: string | null;
  start: (subjectId: number) => Promise<void>;
  selectOption: (option: OptionLabel) => void;
  submitAnswer: () => Promise<void>;
  nextItem: () => void;
}

export function usePractice(): UsePracticeResult {
  const [phase, setPhase] = useState<PracticePhase>('not_started');
  const [items, setItems] = useState<LocalItemForPractice[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selected, setSelected] = useState<OptionLabel | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [correctCount, setCorrectCount] = useState(0);
  const [startError, setStartError] = useState<string | null>(null);
  const sessionIdRef = useRef<number | null>(null);

  const start = useCallback(async (subjectId: number) => {
    setStartError(null);
    const localItems = await loadLocalItems(subjectId);
    if (localItems.length === 0) {
      setStartError('No downloaded items for this subject yet.');
      return;
    }
    const examConfigId = await loadActiveExamConfigId();
    if (examConfigId === null) {
      setStartError('Content has not finished syncing yet — try again shortly.');
      return;
    }

    const startedAt = new Date();
    const endAt = computeSessionEndAt(startedAt, PRACTICE_MAX_DURATION_MINUTES);
    const clientSessionId = generateSyncId(Math.random);
    const sessionId = await startLocalSession(startedAt, endAt, clientSessionId, examConfigId, 'practice');

    sessionIdRef.current = sessionId;
    setItems(localItems);
    setCurrentIndex(0);
    setSelected(null);
    setRevealed(false);
    setCorrectCount(0);
    setPhase('in_progress');
  }, []);

  const selectOption = useCallback(
    (option: OptionLabel) => {
      if (revealed) {
        return;
      }
      setSelected(option);
    },
    [revealed],
  );

  const submitAnswer = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    const item = items[currentIndex];
    if (sessionId === null || !item || selected === null || revealed) {
      return;
    }

    const isCorrect = selected === item.options.find((option) => option.isCorrect)?.label;
    await recordLocalProgressEvent(
      sessionId,
      item.itemId,
      item.subjectId,
      selected,
      isCorrect,
      false,
      new Date(),
      generateSyncId(Math.random),
    );
    setRevealed(true);
    if (isCorrect) {
      setCorrectCount((count) => count + 1);
    }
  }, [items, currentIndex, selected, revealed]);

  const nextItem = useCallback(() => {
    const isLast = currentIndex + 1 >= items.length;
    setSelected(null);
    setRevealed(false);

    if (!isLast) {
      setCurrentIndex(currentIndex + 1);
      return;
    }

    setPhase('finished');
    const sessionId = sessionIdRef.current;
    if (sessionId !== null) {
      // Best-effort, fire-and-forget, exactly like useMockSession.ts's own
      // finishSession — rule 1 means this never blocks the practice UI.
      void endLocalSession(sessionId, new Date()).then(() => syncPendingSessions());
    }
  }, [currentIndex, items.length]);

  return {
    phase,
    currentItem: items[currentIndex] ?? null,
    currentIndex,
    totalItems: items.length,
    selected,
    revealed,
    correctCount,
    startError,
    start,
    selectOption,
    submitAnswer,
    nextItem,
  };
}
