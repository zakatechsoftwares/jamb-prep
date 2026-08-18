import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  applyMockSessionEvent,
  computeEffectiveNow,
  computeRemainingSeconds,
  computeSessionEndAt,
  generateSyncId,
  hasExpired,
  initMockSession,
  type MockSessionState,
  type OptionLabel,
} from '@jamb/shared';
import {
  endLocalSession,
  loadLocalSessionForResume,
  recordLocalProgressEvent,
  startLocalSession,
  updateLastObservedAt,
} from '../lib/database';
import { DEMO_DURATION_MINUTES, DEMO_EXAM_CONFIG_ID, DEMO_ITEMS, findDemoItem } from '../lib/demo-fixture';
import { syncPendingSessions } from '../lib/sync';

/**
 * The mock-session orchestrator, styled after
 * apps/admin/src/hooks/useReviewFlow.ts: owns applyMockSessionEvent's state
 * via a plain useState (there is nothing here `useReducer` gains over it,
 * since every dispatch is preceded by an async SQLite write this hook must
 * await first), performs the I/O (SQLite, not fetch), and dispatches an
 * event only once that write has actually completed -- rule 3 ("every
 * answer is committed to local storage before any state update"),
 * literally in that order, not fire-and-forget.
 */

const ITEM_IDS = DEMO_ITEMS.map((item) => item.itemId);
const TICK_MS = 1000;
const PERSIST_LAST_OBSERVED_EVERY_MS = 10_000;

export type MockSessionPhase = 'loading' | 'not_started' | 'in_progress' | 'finished';

export interface UseMockSessionResult {
  phase: MockSessionPhase;
  session: MockSessionState | null;
  remainingSeconds: number;
  /**
   * Set once `phase` becomes 'finished' -- the results screen navigates to
   * by this id and reloads the score itself from the database, rather than
   * this hook passing `score` across screens. Each screen that calls
   * `useMockSession()` gets its own independent hook instance (there is no
   * shared provider), so any state produced here would not otherwise be
   * visible on a different screen -- the database is the one thing both
   * screens genuinely share.
   */
  sessionId: number | null;
  startSession: () => Promise<void>;
  selectOption: (itemId: number, option: OptionLabel) => Promise<void>;
  toggleFlag: (itemId: number) => Promise<void>;
  navigate: (itemId: number) => void;
}

export function useMockSession(): UseMockSessionResult {
  const [phase, setPhase] = useState<MockSessionPhase>('loading');
  const [session, setSession] = useState<MockSessionState | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [sessionId, setSessionId] = useState<number | null>(null);

  // Mutable, non-rendered session bookkeeping the tick interval and the
  // I/O callbacks below need, but which shouldn't itself trigger a render.
  const sessionIdRef = useRef<number | null>(null);
  const endAtRef = useRef<Date | null>(null);
  const lastObservedAtRef = useRef<Date | null>(null);
  const lastPersistedAtMsRef = useRef(0);

  // The "latest ref" pattern from useReviewFlowKeyboard.ts: selectOption/
  // toggleFlag are async and need the *current* session state to read
  // existing flag/answer state before writing, without depending on
  // `session` in their own useCallback deps (which would change their
  // identity every render `session` changes, exactly the churn CLAUDE.md's
  // "widening a useCallback's deps" entry warns about).
  const sessionStateRef = useRef(session);
  useLayoutEffect(() => {
    sessionStateRef.current = session;
  });

  const finishSession = useCallback(async (occurredAt: Date) => {
    const id = sessionIdRef.current;
    if (id === null) {
      return;
    }
    await endLocalSession(id, occurredAt);
    setPhase('finished');
    // Best-effort, fire-and-forget: rule 1 means the exam itself never
    // depends on this succeeding. A failed attempt just leaves the
    // session's sync_state unchanged for the next trigger (app launch, or
    // this same call next time) to retry -- see sync.ts.
    void syncPendingSessions();
  }, []);

  // Mount: resume an in-progress session if one exists, purely from what's
  // persisted -- no separate "resume" code path, the same design already
  // proven at the logic level in session-repository.integration.test.ts.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const resumed = await loadLocalSessionForResume();
      if (cancelled) {
        return;
      }
      if (!resumed) {
        setPhase('not_started');
        return;
      }

      sessionIdRef.current = resumed.sessionId;
      setSessionId(resumed.sessionId);
      endAtRef.current = resumed.endAt;
      lastObservedAtRef.current = resumed.lastObservedAt;

      let state = initMockSession(ITEM_IDS);
      for (const progress of resumed.progress) {
        if (progress.chosenOption !== null) {
          state = applyMockSessionEvent(state, {
            type: 'select_option',
            itemId: progress.itemId,
            option: progress.chosenOption,
          });
        }
        if (progress.flagged) {
          state = applyMockSessionEvent(state, { type: 'toggle_flag', itemId: progress.itemId });
        }
      }

      const effectiveNow = computeEffectiveNow(new Date(), resumed.lastObservedAt);
      if (hasExpired(resumed.endAt, effectiveNow)) {
        setSession(applyMockSessionEvent(state, { type: 'expire' }));
        setRemainingSeconds(0);
        await finishSession(effectiveNow);
        return;
      }

      setSession(state);
      setRemainingSeconds(computeRemainingSeconds(resumed.endAt, effectiveNow));
      setPhase('in_progress');
    })();
    return () => {
      cancelled = true;
    };
  }, [finishSession]);

  // The ticking display, and the periodic lastObservedAt ratchet write that
  // makes a force-close mid-exam resumable without losing spent time.
  useEffect(() => {
    if (phase !== 'in_progress') {
      return;
    }

    const interval = setInterval(() => {
      const endAt = endAtRef.current;
      const lastObservedAt = lastObservedAtRef.current;
      const sessionId = sessionIdRef.current;
      if (!endAt || !lastObservedAt || sessionId === null) {
        return;
      }

      const actualNow = new Date();
      const effectiveNow = computeEffectiveNow(actualNow, lastObservedAt);
      lastObservedAtRef.current = effectiveNow;
      setRemainingSeconds(computeRemainingSeconds(endAt, effectiveNow));

      if (actualNow.getTime() - lastPersistedAtMsRef.current > PERSIST_LAST_OBSERVED_EVERY_MS) {
        lastPersistedAtMsRef.current = actualNow.getTime();
        void updateLastObservedAt(sessionId, effectiveNow);
      }

      if (hasExpired(endAt, effectiveNow)) {
        clearInterval(interval);
        setSession((current) =>
          current ? applyMockSessionEvent(current, { type: 'expire' }) : current,
        );
        void finishSession(effectiveNow);
      }
    }, TICK_MS);

    return () => clearInterval(interval);
  }, [phase, finishSession]);

  const startSession = useCallback(async () => {
    const startedAt = new Date();
    const endAt = computeSessionEndAt(startedAt, DEMO_DURATION_MINUTES);
    const clientSessionId = generateSyncId(Math.random);
    const newSessionId = await startLocalSession(
      startedAt,
      endAt,
      clientSessionId,
      DEMO_EXAM_CONFIG_ID,
      'mock',
    );

    sessionIdRef.current = newSessionId;
    setSessionId(newSessionId);
    endAtRef.current = endAt;
    lastObservedAtRef.current = startedAt;
    lastPersistedAtMsRef.current = startedAt.getTime();

    setSession(initMockSession(ITEM_IDS));
    setRemainingSeconds(computeRemainingSeconds(endAt, startedAt));
    setPhase('in_progress');
  }, []);

  const selectOption = useCallback(async (itemId: number, option: OptionLabel) => {
    const sessionId = sessionIdRef.current;
    const current = sessionStateRef.current;
    if (sessionId === null || !current) {
      return;
    }
    const flagged = current.progress[itemId]?.flagged ?? false;
    const item = findDemoItem(itemId);
    const isCorrect = option === item.options.find((candidate) => candidate.isCorrect)?.label;
    // Committed to local storage first; the reducer only advances once that
    // write has actually resolved.
    await recordLocalProgressEvent(
      sessionId,
      itemId,
      item.subjectId,
      option,
      isCorrect,
      flagged,
      new Date(),
      generateSyncId(Math.random),
    );
    setSession((latest) =>
      latest ? applyMockSessionEvent(latest, { type: 'select_option', itemId, option }) : latest,
    );
  }, []);

  const toggleFlag = useCallback(async (itemId: number) => {
    const sessionId = sessionIdRef.current;
    const current = sessionStateRef.current;
    if (sessionId === null || !current) {
      return;
    }
    const chosenOption = current.progress[itemId]?.selectedOption ?? null;
    const nextFlagged = !(current.progress[itemId]?.flagged ?? false);
    const item = findDemoItem(itemId);
    const isCorrect =
      chosenOption === null ? null : chosenOption === item.options.find((candidate) => candidate.isCorrect)?.label;
    await recordLocalProgressEvent(
      sessionId,
      itemId,
      item.subjectId,
      chosenOption,
      isCorrect,
      nextFlagged,
      new Date(),
      generateSyncId(Math.random),
    );
    setSession((latest) =>
      latest ? applyMockSessionEvent(latest, { type: 'toggle_flag', itemId }) : latest,
    );
  }, []);

  const navigate = useCallback((itemId: number) => {
    setSession((current) =>
      current ? applyMockSessionEvent(current, { type: 'navigate', itemId }) : current,
    );
  }, []);

  return { phase, session, remainingSeconds, sessionId, startSession, selectOption, toggleFlag, navigate };
}
