import * as SQLite from 'expo-sqlite';
import type { OptionLabel, ScoringAttempt } from '@jamb/shared';
import { findDemoItem } from './demo-fixture';

/**
 * The only place this app touches SQL. `local_attempts` mirrors the real
 * `attempts` table's append-only shape (rule 2) even locally: every
 * select_option/toggle_flag event from mock-session-reducer.ts writes a new
 * row, never an update, so this stays a natural fit for the eventual sync
 * layer instead of needing a redesign once one exists. `chosen_option` is
 * null for a flag-only event (mock-session-reducer.ts deliberately allows
 * flagging an unanswered item) -- resume reconstructs current progress by
 * taking the latest row per item, and only rows with a real chosen_option
 * ever count toward scoring.
 *
 * Correctness is recomputed here from the fixture's own key, never trusted
 * from a caller -- the same discipline session-repository.ts's
 * recordAttempt already established server-side.
 *
 * `local_candidate`, `local_sessions.client_session_id`/`exam_config_id`/
 * `mode`/`server_session_id`/`sync_state`, and `local_attempts.idempotency_key`
 * were added for progress sync (plan 8.3, follow-up to session 12) -- see
 * `sync.ts`. This app has no real installed users yet, so these are added
 * directly to the `CREATE TABLE IF NOT EXISTS` statements rather than an
 * `ALTER TABLE` migration path; that becomes necessary once a real release
 * exists with data worth preserving across an upgrade.
 */

let db: SQLite.SQLiteDatabase | null = null;

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!db) {
    db = await SQLite.openDatabaseAsync('jamb-mobile.db');
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS local_candidate (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        user_id INTEGER NOT NULL,
        token TEXT NOT NULL,
        device_id TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS local_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at TEXT NOT NULL,
        end_at TEXT NOT NULL,
        last_observed_at TEXT NOT NULL,
        ended_at TEXT,
        client_session_id TEXT NOT NULL,
        exam_config_id INTEGER NOT NULL,
        mode TEXT NOT NULL,
        server_session_id INTEGER,
        sync_state TEXT NOT NULL DEFAULT 'local_only'
      );
      CREATE TABLE IF NOT EXISTS local_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        item_id INTEGER NOT NULL,
        subject_id INTEGER NOT NULL,
        chosen_option TEXT,
        is_correct INTEGER,
        flagged INTEGER NOT NULL,
        occurred_at TEXT NOT NULL,
        idempotency_key TEXT NOT NULL
      );
    `);
  }
  return db;
}

export interface LocalCandidate {
  userId: number;
  token: string;
  deviceId: string;
}

/** Singleton row -- one registered candidate identity per installed app. */
export async function saveLocalCandidate(userId: number, token: string, deviceId: string): Promise<void> {
  const database = await getDb();
  await database.runAsync(
    `INSERT INTO local_candidate (id, user_id, token, device_id) VALUES (1, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET user_id = excluded.user_id, token = excluded.token, device_id = excluded.device_id`,
    [userId, token, deviceId],
  );
}

export async function loadLocalCandidate(): Promise<LocalCandidate | null> {
  const database = await getDb();
  const row = await database.getFirstAsync<{ user_id: number; token: string; device_id: string }>(
    `SELECT user_id, token, device_id FROM local_candidate WHERE id = 1`,
  );
  if (!row) {
    return null;
  }
  return { userId: row.user_id, token: row.token, deviceId: row.device_id };
}

export async function startLocalSession(
  startedAt: Date,
  endAt: Date,
  clientSessionId: string,
  examConfigId: number,
  mode: 'practice' | 'mock',
): Promise<number> {
  const database = await getDb();
  const result = await database.runAsync(
    `INSERT INTO local_sessions (
       started_at, end_at, last_observed_at, ended_at,
       client_session_id, exam_config_id, mode
     ) VALUES (?, ?, ?, NULL, ?, ?, ?)`,
    [
      startedAt.toISOString(),
      endAt.toISOString(),
      startedAt.toISOString(),
      clientSessionId,
      examConfigId,
      mode,
    ],
  );
  return result.lastInsertRowId;
}

export async function updateLastObservedAt(sessionId: number, lastObservedAt: Date): Promise<void> {
  const database = await getDb();
  await database.runAsync(`UPDATE local_sessions SET last_observed_at = ? WHERE id = ?`, [
    lastObservedAt.toISOString(),
    sessionId,
  ]);
}

export async function endLocalSession(sessionId: number, endedAt: Date): Promise<void> {
  const database = await getDb();
  await database.runAsync(`UPDATE local_sessions SET ended_at = ? WHERE id = ?`, [
    endedAt.toISOString(),
    sessionId,
  ]);
}

export async function recordLocalProgressEvent(
  sessionId: number,
  itemId: number,
  chosenOption: OptionLabel | null,
  flagged: boolean,
  occurredAt: Date,
  idempotencyKey: string,
): Promise<void> {
  const item = findDemoItem(itemId);
  let isCorrect: boolean | null = null;
  if (chosenOption !== null) {
    const correctOption = item.options.find((option) => option.isCorrect)?.label;
    isCorrect = chosenOption === correctOption;
  }

  const database = await getDb();
  await database.withExclusiveTransactionAsync(async () => {
    await database.runAsync(
      `INSERT INTO local_attempts (
         session_id, item_id, subject_id, chosen_option, is_correct, flagged, occurred_at, idempotency_key
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sessionId,
        itemId,
        item.subjectId,
        chosenOption,
        isCorrect === null ? null : isCorrect ? 1 : 0,
        flagged ? 1 : 0,
        occurredAt.toISOString(),
        idempotencyKey,
      ],
    );
  });
}

export interface LocalItemProgress {
  itemId: number;
  chosenOption: OptionLabel | null;
  flagged: boolean;
}

export interface LocalSessionResume {
  sessionId: number;
  startedAt: Date;
  endAt: Date;
  lastObservedAt: Date;
  progress: LocalItemProgress[];
}

/** The only local session that can be in progress (no ended_at yet) — this demo runs one mock at a time. */
export async function loadLocalSessionForResume(): Promise<LocalSessionResume | null> {
  const database = await getDb();
  const session = await database.getFirstAsync<{
    id: number;
    started_at: string;
    end_at: string;
    last_observed_at: string;
  }>(`SELECT id, started_at, end_at, last_observed_at FROM local_sessions WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1`);
  if (!session) {
    return null;
  }

  const rows = await database.getAllAsync<{
    item_id: number;
    chosen_option: OptionLabel | null;
    flagged: number;
  }>(
    `SELECT item_id, chosen_option, flagged FROM local_attempts WHERE session_id = ? ORDER BY id ASC`,
    [session.id],
  );

  const latestByItem = new Map<number, LocalItemProgress>();
  for (const row of rows) {
    latestByItem.set(row.item_id, {
      itemId: row.item_id,
      chosenOption: row.chosen_option,
      flagged: row.flagged === 1,
    });
  }

  return {
    sessionId: session.id,
    startedAt: new Date(session.started_at),
    endAt: new Date(session.end_at),
    lastObservedAt: new Date(session.last_observed_at),
    progress: [...latestByItem.values()],
  };
}

/**
 * Every real answer for this session, in the ScoringAttempt shape
 * scoreExam expects -- including historical re-answers. `sequence` orders
 * them per item; scoreExam resolves which is "latest" itself
 * (resolveLatestAttemptPerItem), the same as the server-side path, so
 * nothing here pre-filters to "only the newest."
 */
export async function loadScoringAttempts(sessionId: number): Promise<ScoringAttempt[]> {
  const database = await getDb();
  const rows = await database.getAllAsync<{
    item_id: number;
    subject_id: number;
    is_correct: number | null;
  }>(
    `SELECT item_id, subject_id, is_correct FROM local_attempts
      WHERE session_id = ? AND chosen_option IS NOT NULL
      ORDER BY id ASC`,
    [sessionId],
  );

  const sequenceByItem = new Map<number, number>();
  return rows.map((row) => {
    const sequence = (sequenceByItem.get(row.item_id) ?? 0) + 1;
    sequenceByItem.set(row.item_id, sequence);
    return {
      itemId: row.item_id,
      subjectId: row.subject_id,
      isCorrect: row.is_correct === 1,
      sequence,
    };
  });
}

export interface LocalSessionForSync {
  sessionId: number;
  startedAt: Date;
  endedAt: Date | null;
  clientSessionId: string;
  examConfigId: number;
  mode: 'practice' | 'mock';
}

/**
 * Every finished session not yet marked `synced` (plan 8.3's device->server
 * half) — `sync.ts` retries the whole sequence for each, relying on
 * `startSession`/`recordAttempt` already being idempotent server-side
 * rather than tracking partial upload progress locally.
 */
export async function loadSessionsNeedingSync(): Promise<LocalSessionForSync[]> {
  const database = await getDb();
  const rows = await database.getAllAsync<{
    id: number;
    started_at: string;
    ended_at: string | null;
    client_session_id: string;
    exam_config_id: number;
    mode: 'practice' | 'mock';
  }>(
    `SELECT id, started_at, ended_at, client_session_id, exam_config_id, mode
       FROM local_sessions
      WHERE ended_at IS NOT NULL AND sync_state != 'synced'
      ORDER BY id ASC`,
  );

  return rows.map((row) => ({
    sessionId: row.id,
    startedAt: new Date(row.started_at),
    endedAt: row.ended_at ? new Date(row.ended_at) : null,
    clientSessionId: row.client_session_id,
    examConfigId: row.exam_config_id,
    mode: row.mode,
  }));
}

export interface LocalProgressEventRow {
  itemId: number;
  chosenOption: OptionLabel | null;
  flagged: boolean;
  occurredAt: Date;
  idempotencyKey: string;
}

/** Every event for a session, in occurred_at order -- both answer and flag-only rows, per buildAttemptUploadPayloads' own contract. */
export async function loadLocalProgressEvents(sessionId: number): Promise<LocalProgressEventRow[]> {
  const database = await getDb();
  const rows = await database.getAllAsync<{
    item_id: number;
    chosen_option: OptionLabel | null;
    flagged: number;
    occurred_at: string;
    idempotency_key: string;
  }>(
    `SELECT item_id, chosen_option, flagged, occurred_at, idempotency_key
       FROM local_attempts WHERE session_id = ? ORDER BY id ASC`,
    [sessionId],
  );

  return rows.map((row) => ({
    itemId: row.item_id,
    chosenOption: row.chosen_option,
    flagged: row.flagged === 1,
    occurredAt: new Date(row.occurred_at),
    idempotencyKey: row.idempotency_key,
  }));
}

export async function markSessionSynced(sessionId: number, serverSessionId: number): Promise<void> {
  const database = await getDb();
  await database.runAsync(
    `UPDATE local_sessions SET sync_state = 'synced', server_session_id = ? WHERE id = ?`,
    [serverSessionId, sessionId],
  );
}
