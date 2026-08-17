import type { Pool, PoolClient } from 'pg';
import { scoreExam, type OptionLabel, type ScoreResult, type ScoringAttempt } from '@jamb/shared';
import { pool } from './client';
import { firstRow } from './first-row';
import { loadExamConfigForUser } from './exam-config-repository';

/**
 * The candidate exam-session/attempt repository (plan §8.3/§8.4, canonical
 * session 12) — the first application code to read or write `sessions`
 * (migration 0007) and `attempts` (migration 0008), both of which have
 * existed since session 03 with no repository layer until now.
 */

export interface StartSessionInput {
  userId: number;
  examConfigId: number;
  mode: 'practice' | 'mock';
  deviceId: string;
  /** Client-generated, unique per session — the offline-first idempotency key (plan 8.3). */
  clientSessionId: string;
  startedAt: Date;
}

/** Idempotent on `clientSessionId`, the same conflict-then-lookup pattern `decideOnItem` uses for `idempotency_key`. */
export async function startSession(input: StartSessionInput, client?: PoolClient): Promise<number> {
  const runner: Pool | PoolClient = client ?? pool;

  const inserted = await runner.query<{ id: number }>(
    `INSERT INTO sessions (user_id, exam_config_id, mode, device_id, client_session_id, started_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (client_session_id) DO NOTHING
     RETURNING id`,
    [input.userId, input.examConfigId, input.mode, input.deviceId, input.clientSessionId, input.startedAt],
  );
  if ((inserted.rowCount ?? 0) > 0) {
    return firstRow(inserted).id;
  }

  return firstRow(
    await runner.query<{ id: number }>(`SELECT id FROM sessions WHERE client_session_id = $1`, [
      input.clientSessionId,
    ]),
  ).id;
}

export async function endSession(sessionId: number, endedAt: Date, client?: PoolClient): Promise<void> {
  const runner: Pool | PoolClient = client ?? pool;
  await runner.query(`UPDATE sessions SET ended_at = $2 WHERE id = $1`, [sessionId, endedAt]);
}

export interface RecordAttemptInput {
  sessionId: number;
  itemId: number;
  userId: number;
  chosenOption: OptionLabel;
  secondsTaken: number;
  flagged: boolean;
  answeredAt: Date;
  /** Client-generated, unique per attempt — never a fresh key per retry (plan 8.3). */
  idempotencyKey: string;
}

/**
 * Records one attempt, idempotent on `idempotencyKey`. `isCorrect` is
 * never accepted from the caller — CLAUDE.md rule 5 ("the client may
 * compute a provisional score for instant feedback; the server recomputes
 * and its result wins") means correctness is looked up from the item's
 * actual key here, server-side, every time, not trusted from the request.
 */
export async function recordAttempt(input: RecordAttemptInput, client?: PoolClient): Promise<number> {
  const runner: Pool | PoolClient = client ?? pool;

  const correctOption = firstRow(
    await runner.query<{ label: OptionLabel }>(
      `SELECT label FROM item_options WHERE item_id = $1 AND is_correct`,
      [input.itemId],
    ),
  ).label;
  const isCorrect = input.chosenOption === correctOption;

  const inserted = await runner.query<{ id: number }>(
    `INSERT INTO attempts (
       session_id, item_id, user_id, chosen_option, is_correct,
       seconds_taken, flagged, answered_at, idempotency_key
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id`,
    [
      input.sessionId,
      input.itemId,
      input.userId,
      input.chosenOption,
      isCorrect,
      input.secondsTaken,
      input.flagged,
      input.answeredAt,
      input.idempotencyKey,
    ],
  );
  if ((inserted.rowCount ?? 0) > 0) {
    return firstRow(inserted).id;
  }

  return firstRow(
    await runner.query<{ id: number }>(`SELECT id FROM attempts WHERE idempotency_key = $1`, [
      input.idempotencyKey,
    ]),
  ).id;
}

export interface SessionAttemptRow {
  itemId: number;
  subjectId: number;
  chosenOption: OptionLabel;
  isCorrect: boolean;
  secondsTaken: number;
  flagged: boolean;
  answeredAt: Date;
  /** Per-item re-answer ordinal, matching scoring.ts's own resolution rule — 1 for a first answer, 2 for a changed answer, and so on. */
  sequence: number;
}

export interface SessionForResume {
  sessionId: number;
  userId: number;
  startedAt: Date;
  endedAt: Date | null;
  examConfigId: number;
  attempts: SessionAttemptRow[];
}

/**
 * The server-side half of "resume with every prior answer intact" (plan
 * 8.3's multi-device continuity) — reconstructs a session's full attempt
 * history purely from what's already persisted, ordered `created_at ASC,
 * id ASC` per `packages/shared/README.md`'s documented tiebreak (two
 * attempts can share a `created_at` to the millisecond; the primary key
 * is the real tiebreak).
 */
export async function loadSessionForResume(
  clientSessionId: string,
  client?: PoolClient,
): Promise<SessionForResume | null> {
  const runner: Pool | PoolClient = client ?? pool;

  const sessionResult = await runner.query<{
    id: number;
    user_id: number;
    started_at: Date;
    ended_at: Date | null;
    exam_config_id: number;
  }>(
    `SELECT id, user_id, started_at, ended_at, exam_config_id FROM sessions WHERE client_session_id = $1`,
    [clientSessionId],
  );
  const session = sessionResult.rows[0];
  if (!session) {
    return null;
  }

  const attemptsResult = await runner.query<{
    item_id: number;
    subject_id: number;
    chosen_option: OptionLabel;
    is_correct: boolean;
    seconds_taken: number;
    flagged: boolean;
    answered_at: Date;
  }>(
    `SELECT a.item_id, i.subject_id, a.chosen_option, a.is_correct, a.seconds_taken, a.flagged, a.answered_at
       FROM attempts a
       JOIN items i ON i.id = a.item_id
      WHERE a.session_id = $1
      ORDER BY a.created_at ASC, a.id ASC`,
    [session.id],
  );

  const sequenceByItem = new Map<number, number>();
  const attempts: SessionAttemptRow[] = attemptsResult.rows.map((row) => {
    const sequence = (sequenceByItem.get(row.item_id) ?? 0) + 1;
    sequenceByItem.set(row.item_id, sequence);
    return {
      itemId: row.item_id,
      subjectId: row.subject_id,
      chosenOption: row.chosen_option,
      isCorrect: row.is_correct,
      secondsTaken: row.seconds_taken,
      flagged: row.flagged,
      answeredAt: row.answered_at,
      sequence,
    };
  });

  return {
    sessionId: session.id,
    userId: session.user_id,
    startedAt: session.started_at,
    endedAt: session.ended_at,
    examConfigId: session.exam_config_id,
    attempts,
  };
}

/**
 * Server-authoritative scoring (CLAUDE.md rule 5) — composes
 * `loadExamConfigForUser` with this session's own attempt stream and hands
 * both to `scoreExam` unchanged. This is the one place a session's score is
 * actually computed; a client-side provisional score is never trusted.
 */
export async function scoreSession(sessionId: number, client?: PoolClient): Promise<ScoreResult> {
  const runner: Pool | PoolClient = client ?? pool;

  const session = firstRow(
    await runner.query<{ client_session_id: string }>(
      `SELECT client_session_id FROM sessions WHERE id = $1`,
      [sessionId],
    ),
  );

  const resumed = await loadSessionForResume(session.client_session_id, client);
  if (!resumed) {
    throw new Error(`scoreSession: session ${sessionId} not found`);
  }

  const { config } = await loadExamConfigForUser(resumed.userId, client);

  const scoringAttempts: ScoringAttempt[] = resumed.attempts.map((attempt) => ({
    itemId: attempt.itemId,
    subjectId: attempt.subjectId,
    isCorrect: attempt.isCorrect,
    sequence: attempt.sequence,
  }));

  return scoreExam(config, scoringAttempts);
}
