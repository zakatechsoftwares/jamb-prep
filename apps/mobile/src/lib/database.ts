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
 */

let db: SQLite.SQLiteDatabase | null = null;

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!db) {
    db = await SQLite.openDatabaseAsync('jamb-mobile.db');
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS local_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at TEXT NOT NULL,
        end_at TEXT NOT NULL,
        last_observed_at TEXT NOT NULL,
        ended_at TEXT
      );
      CREATE TABLE IF NOT EXISTS local_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        item_id INTEGER NOT NULL,
        subject_id INTEGER NOT NULL,
        chosen_option TEXT,
        is_correct INTEGER,
        flagged INTEGER NOT NULL,
        occurred_at TEXT NOT NULL
      );
    `);
  }
  return db;
}

export async function startLocalSession(startedAt: Date, endAt: Date): Promise<number> {
  const database = await getDb();
  const result = await database.runAsync(
    `INSERT INTO local_sessions (started_at, end_at, last_observed_at, ended_at) VALUES (?, ?, ?, NULL)`,
    startedAt.toISOString(),
    endAt.toISOString(),
    startedAt.toISOString(),
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
      `INSERT INTO local_attempts (session_id, item_id, subject_id, chosen_option, is_correct, flagged, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        sessionId,
        itemId,
        item.subjectId,
        chosenOption,
        isCorrect === null ? null : isCorrect ? 1 : 0,
        flagged ? 1 : 0,
        occurredAt.toISOString(),
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
