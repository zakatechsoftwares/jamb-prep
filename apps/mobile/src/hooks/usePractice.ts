import { useCallback, useEffect, useRef, useState } from 'react';
import {
  applyPracticeEvent,
  computeSessionEndAt,
  generateSyncId,
  initPracticeSession,
  practiceSummary,
  type OptionLabel,
  type PracticeAnswer,
  type PracticeEvent,
  type PracticeSessionState,
  type PracticeSummary,
} from '@jamb/shared';
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
 * one subject, no consolidated timer, no flags. Navigation, answering and
 * finishing are decided by @jamb/shared's practice-session-reducer (rule 7);
 * this hook only does the I/O around it. A `mode: 'practice'` local session
 * goes through the same `recordLocalProgressEvent`/`sync.ts` pipeline Mock
 * mode uses, unmodified.
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
  /** The pending choice on an unanswered question, or the recorded choice on an answered one. */
  selected: OptionLabel | null;
  /** The current question has been answered: show its result and explanation, review-only. */
  revealed: boolean;
  /** One entry per question in serving order, for the palette; null = not answered yet. */
  answers: (PracticeAnswer | null)[];
  summary: PracticeSummary;
  canGoPrevious: boolean;
  canGoNext: boolean;
  /** Null until a subject has been chosen; distinguishes "not started" from "no items were found for that subject." */
  startError: string | null;
  start: (subjectId: number) => Promise<void>;
  selectOption: (option: OptionLabel) => void;
  submitAnswer: () => Promise<void>;
  goPrevious: () => void;
  goNext: () => void;
  goTo: (index: number) => void;
  finish: () => void;
}

const EMPTY_SUMMARY: PracticeSummary = { total: 0, answered: 0, correct: 0, unanswered: 0 };

export function usePractice(): UsePracticeResult {
  const [items, setItems] = useState<LocalItemForPractice[]>([]);
  const [session, setSession] = useState<PracticeSessionState | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const sessionIdRef = useRef<number | null>(null);
  // Whether the local session row still needs ending. Set when a session
  // starts; cleared the moment it is ended, so finishing and then leaving
  // the screen never ends it twice.
  const openSessionRef = useRef(false);

  const endSession = useCallback(() => {
    const sessionId = sessionIdRef.current;
    if (sessionId === null || !openSessionRef.current) {
      return;
    }
    openSessionRef.current = false;
    // Best-effort, fire-and-forget, exactly like useMockSession.ts's own
    // finishSession — rule 1 means this never blocks the practice UI.
    void endLocalSession(sessionId, new Date()).then(() => syncPendingSessions());
  }, []);

  // Leaving the screen part-way (back button, "Change subject") ends the
  // session too. Before this, only answering the last question did, and a
  // session left open never synced and was later mistaken for a mock to resume.
  useEffect(() => endSession, [endSession]);

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

    let initial: PracticeSessionState;
    try {
      initial = initPracticeSession(
        localItems.map((item) => ({
          itemId: item.itemId,
          correctOption: item.options.find((option) => option.isCorrect)?.label as OptionLabel,
        })),
      );
    } catch {
      setStartError('This subject’s downloaded questions look damaged. Try downloading it again.');
      return;
    }

    const startedAt = new Date();
    const endAt = computeSessionEndAt(startedAt, PRACTICE_MAX_DURATION_MINUTES);
    const clientSessionId = generateSyncId(Math.random);
    const sessionId = await startLocalSession(startedAt, endAt, clientSessionId, examConfigId, 'practice');

    sessionIdRef.current = sessionId;
    openSessionRef.current = true;
    setItems(localItems);
    setSession(initial);
  }, []);

  // The reducer throws on an impossible move. A fast double-tap can queue two
  // moves before the screen redraws, so the bounds are checked here, against
  // the latest state inside the update, rather than against what was drawn.
  const apply = useCallback((event: PracticeEvent) => {
    setSession((current) => {
      if (!current || current.finished) {
        return current;
      }
      const atFirst = current.currentIndex === 0;
      const atLast = current.currentIndex >= current.items.length - 1;
      const currentAnswered = current.items[current.currentIndex]!.itemId in current.answers;
      if (
        (event.type === 'previous' && atFirst) ||
        (event.type === 'next' && atLast) ||
        (event.type === 'go_to' && (event.index < 0 || event.index >= current.items.length)) ||
        (event.type === 'select' && currentAnswered)
      ) {
        return current;
      }
      return applyPracticeEvent(current, event);
    });
  }, []);

  const submitAnswer = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    if (sessionId === null || !session || session.finished) {
      return;
    }
    const item = items[session.currentIndex];
    if (!item) {
      return;
    }

    const next = applyPracticeEvent(session, { type: 'submit' });
    const answer = next.answers[item.itemId]!;
    // Rule 3: the answer is committed to local storage before the screen
    // moves on to showing it as answered.
    await recordLocalProgressEvent(
      sessionId,
      item.itemId,
      item.subjectId,
      answer.selected,
      answer.isCorrect,
      false,
      new Date(),
      generateSyncId(Math.random),
    );
    setSession(next);
  }, [items, session]);

  const finish = useCallback(() => {
    apply({ type: 'finish' });
    endSession();
  }, [apply, endSession]);

  const currentItem = session ? (items[session.currentIndex] ?? null) : null;
  const recorded = currentItem && session ? session.answers[currentItem.itemId] : undefined;
  const canGoPrevious = session !== null && !session.finished && session.currentIndex > 0;
  const canGoNext =
    session !== null && !session.finished && session.currentIndex < session.items.length - 1;

  return {
    phase: session === null ? 'not_started' : session.finished ? 'finished' : 'in_progress',
    currentItem,
    currentIndex: session?.currentIndex ?? 0,
    totalItems: items.length,
    selected: recorded ? recorded.selected : (session?.pendingSelection ?? null),
    revealed: recorded !== undefined,
    answers: session ? session.items.map((item) => session.answers[item.itemId] ?? null) : [],
    summary: session ? practiceSummary(session) : EMPTY_SUMMARY,
    canGoPrevious,
    canGoNext,
    startError,
    start,
    selectOption: (option) => apply({ type: 'select', option }),
    submitAnswer,
    goPrevious: () => apply({ type: 'previous' }),
    goNext: () => apply({ type: 'next' }),
    goTo: (index) => apply({ type: 'go_to', index }),
    finish,
  };
}
