import * as SQLite from 'expo-sqlite';
import type { OptionLabel, ScoringAttempt } from '@jamb/shared';

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
 *
 * `local_items`/`local_item_options`/`local_content_versions` were added
 * for content sync (plan 8.3's server-to-device half, follow-up to
 * progress sync) -- a downloaded subject pack's real content, replacing
 * `demo-fixture.ts` for Practice mode specifically (Mock mode stays on the
 * fixture; see content-sync.ts's own doc comment for why). `local_items.id`
 * is the real server item id, not autoincrement, so a redownload is a
 * plain delete-and-reinsert keyed on it rather than needing an id mapping.
 *
 * `local_candidate.subject_combination_id`/`course_name` (nullable) were
 * added for subject-combination onboarding -- denormalized locally, same
 * convention as `token`/`deviceId`, purely so the app can show "your
 * course: X" without a round trip. The server's `users.subject_combination_id`
 * stays the one authoritative copy; nothing here is read back to decide
 * whether a candidate *may* do anything.
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
        device_id TEXT NOT NULL,
        subject_combination_id INTEGER,
        course_name TEXT
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
      CREATE TABLE IF NOT EXISTS local_exam_config (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        exam_config_id INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS local_content_versions (
        subject_id INTEGER PRIMARY KEY,
        subject_name TEXT NOT NULL,
        version TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS local_items (
        id INTEGER PRIMARY KEY,
        subject_id INTEGER NOT NULL,
        stem TEXT NOT NULL,
        explanation TEXT NOT NULL,
        method_steps TEXT NOT NULL,
        cognitive_level TEXT NOT NULL,
        expected_time_seconds INTEGER NOT NULL,
        diagram_svg TEXT,
        diagram_alt_text TEXT
      );
      CREATE TABLE IF NOT EXISTS local_item_options (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id INTEGER NOT NULL,
        label TEXT NOT NULL,
        option_text TEXT NOT NULL,
        is_correct INTEGER NOT NULL,
        distractor_rationale TEXT
      );
      CREATE INDEX IF NOT EXISTS local_item_options_item_id_idx ON local_item_options (item_id);
    `);
  }
  return db;
}

export interface LocalCandidate {
  userId: number;
  token: string;
  deviceId: string;
  subjectCombinationId: number | null;
  courseName: string | null;
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

/** Denormalized locally purely for display ("your course: X") -- the server's users.subject_combination_id is the one authoritative copy. */
export async function saveLocalSubjectCombination(subjectCombinationId: number, courseName: string): Promise<void> {
  const database = await getDb();
  await database.runAsync(
    `UPDATE local_candidate SET subject_combination_id = ?, course_name = ? WHERE id = 1`,
    [subjectCombinationId, courseName],
  );
}

export async function loadLocalCandidate(): Promise<LocalCandidate | null> {
  const database = await getDb();
  const row = await database.getFirstAsync<{
    user_id: number;
    token: string;
    device_id: string;
    subject_combination_id: number | null;
    course_name: string | null;
  }>(`SELECT user_id, token, device_id, subject_combination_id, course_name FROM local_candidate WHERE id = 1`);
  if (!row) {
    return null;
  }
  return {
    userId: row.user_id,
    token: row.token,
    deviceId: row.device_id,
    subjectCombinationId: row.subject_combination_id,
    courseName: row.course_name,
  };
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

/**
 * `subjectId`/`isCorrect` are supplied by the caller rather than looked up
 * here, so this table stays agnostic to *which* item source is in play --
 * `useMockSession.ts` resolves both from `demo-fixture.ts` (Mock mode);
 * `usePractice.ts` resolves both from `local_items`/`local_item_options`
 * (Practice mode, real downloaded content). Local scoring is provisional
 * either way (rule 5) -- correctness computed here is never what a synced
 * session is ultimately scored by.
 */
export async function recordLocalProgressEvent(
  sessionId: number,
  itemId: number,
  subjectId: number,
  chosenOption: OptionLabel | null,
  isCorrect: boolean | null,
  flagged: boolean,
  occurredAt: Date,
  idempotencyKey: string,
): Promise<void> {
  const database = await getDb();
  await database.withExclusiveTransactionAsync(async () => {
    await database.runAsync(
      `INSERT INTO local_attempts (
         session_id, item_id, subject_id, chosen_option, is_correct, flagged, occurred_at, idempotency_key
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sessionId,
        itemId,
        subjectId,
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

/** Learned from content sync's manifest (`SubjectPackManifest.activeExamConfigId`) -- see content-sync.ts. */
export async function saveActiveExamConfigId(examConfigId: number): Promise<void> {
  const database = await getDb();
  await database.runAsync(
    `INSERT INTO local_exam_config (id, exam_config_id) VALUES (1, ?)
     ON CONFLICT (id) DO UPDATE SET exam_config_id = excluded.exam_config_id`,
    [examConfigId],
  );
}

export async function loadActiveExamConfigId(): Promise<number | null> {
  const database = await getDb();
  const row = await database.getFirstAsync<{ exam_config_id: number }>(
    `SELECT exam_config_id FROM local_exam_config WHERE id = 1`,
  );
  return row?.exam_config_id ?? null;
}

export interface LocalItemOption {
  label: OptionLabel;
  text: string;
  isCorrect: boolean;
}

export interface LocalItemForPractice {
  itemId: number;
  subjectId: number;
  stem: string;
  explanation: string;
  methodSteps: string[];
  options: LocalItemOption[];
  diagram: { svgMarkup: string; altText: string } | null;
}

export async function loadLocalContentVersion(subjectId: number): Promise<string | null> {
  const database = await getDb();
  const row = await database.getFirstAsync<{ version: string }>(
    `SELECT version FROM local_content_versions WHERE subject_id = ?`,
    [subjectId],
  );
  return row?.version ?? null;
}

export interface SubjectPackToSave {
  subjectId: number;
  subjectName: string;
  version: string;
  items: {
    itemId: number;
    stem: string;
    explanation: string;
    methodSteps: string[];
    cognitiveLevel: string;
    expectedTimeSeconds: number;
    options: { label: OptionLabel; text: string; isCorrect: boolean; distractorRationale: string | null }[];
    diagram: { svgMarkup: string; altText: string } | null;
  }[];
}

/** Replaces this subject's entire local item set -- a redownload is always a full replace, never a merge (plan 8.3's simplified, non-delta content sync). */
export async function saveSubjectPack(pack: SubjectPackToSave): Promise<void> {
  const database = await getDb();
  await database.withExclusiveTransactionAsync(async () => {
    const existing = await database.getAllAsync<{ id: number }>(
      `SELECT id FROM local_items WHERE subject_id = ?`,
      [pack.subjectId],
    );
    for (const row of existing) {
      await database.runAsync(`DELETE FROM local_item_options WHERE item_id = ?`, [row.id]);
    }
    await database.runAsync(`DELETE FROM local_items WHERE subject_id = ?`, [pack.subjectId]);

    for (const item of pack.items) {
      await database.runAsync(
        `INSERT INTO local_items (
           id, subject_id, stem, explanation, method_steps, cognitive_level,
           expected_time_seconds, diagram_svg, diagram_alt_text
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          item.itemId,
          pack.subjectId,
          item.stem,
          item.explanation,
          JSON.stringify(item.methodSteps),
          item.cognitiveLevel,
          item.expectedTimeSeconds,
          item.diagram?.svgMarkup ?? null,
          item.diagram?.altText ?? null,
        ],
      );
      for (const option of item.options) {
        await database.runAsync(
          `INSERT INTO local_item_options (item_id, label, option_text, is_correct, distractor_rationale)
           VALUES (?, ?, ?, ?, ?)`,
          [item.itemId, option.label, option.text, option.isCorrect ? 1 : 0, option.distractorRationale],
        );
      }
    }

    await database.runAsync(
      `INSERT INTO local_content_versions (subject_id, subject_name, version) VALUES (?, ?, ?)
       ON CONFLICT (subject_id) DO UPDATE SET subject_name = excluded.subject_name, version = excluded.version`,
      [pack.subjectId, pack.subjectName, pack.version],
    );
  });
}

export interface DownloadedSubject {
  subjectId: number;
  subjectName: string;
  itemCount: number;
}

export async function loadDownloadedSubjects(): Promise<DownloadedSubject[]> {
  const database = await getDb();
  const rows = await database.getAllAsync<{ subject_id: number; subject_name: string; item_count: number }>(
    `SELECT v.subject_id, v.subject_name, count(i.id) AS item_count
       FROM local_content_versions v
       LEFT JOIN local_items i ON i.subject_id = v.subject_id
      GROUP BY v.subject_id, v.subject_name
      HAVING count(i.id) > 0
      ORDER BY v.subject_name`,
  );
  return rows.map((row) => ({
    subjectId: row.subject_id,
    subjectName: row.subject_name,
    itemCount: row.item_count,
  }));
}

export async function loadLocalItems(subjectId: number): Promise<LocalItemForPractice[]> {
  const database = await getDb();
  const items = await database.getAllAsync<{
    id: number;
    subject_id: number;
    stem: string;
    explanation: string;
    method_steps: string;
    diagram_svg: string | null;
    diagram_alt_text: string | null;
  }>(`SELECT id, subject_id, stem, explanation, method_steps, diagram_svg, diagram_alt_text FROM local_items WHERE subject_id = ? ORDER BY id`, [
    subjectId,
  ]);

  const result: LocalItemForPractice[] = [];
  for (const item of items) {
    const options = await database.getAllAsync<{ label: OptionLabel; option_text: string; is_correct: number }>(
      `SELECT label, option_text, is_correct FROM local_item_options WHERE item_id = ? ORDER BY label`,
      [item.id],
    );
    result.push({
      itemId: item.id,
      subjectId: item.subject_id,
      stem: item.stem,
      explanation: item.explanation,
      methodSteps: JSON.parse(item.method_steps) as string[],
      options: options.map((option) => ({
        label: option.label,
        text: option.option_text,
        isCorrect: option.is_correct === 1,
      })),
      diagram:
        item.diagram_svg !== null && item.diagram_alt_text !== null
          ? { svgMarkup: item.diagram_svg, altText: item.diagram_alt_text }
          : null,
    });
  }
  return result;
}

export async function findLocalItem(itemId: number): Promise<LocalItemForPractice | null> {
  const database = await getDb();
  const item = await database.getFirstAsync<{
    id: number;
    subject_id: number;
    stem: string;
    explanation: string;
    method_steps: string;
    diagram_svg: string | null;
    diagram_alt_text: string | null;
  }>(`SELECT id, subject_id, stem, explanation, method_steps, diagram_svg, diagram_alt_text FROM local_items WHERE id = ?`, [
    itemId,
  ]);
  if (!item) {
    return null;
  }
  const options = await database.getAllAsync<{ label: OptionLabel; option_text: string; is_correct: number }>(
    `SELECT label, option_text, is_correct FROM local_item_options WHERE item_id = ? ORDER BY label`,
    [item.id],
  );
  return {
    itemId: item.id,
    subjectId: item.subject_id,
    stem: item.stem,
    explanation: item.explanation,
    methodSteps: JSON.parse(item.method_steps) as string[],
    options: options.map((option) => ({
      label: option.label,
      text: option.option_text,
      isCorrect: option.is_correct === 1,
    })),
    diagram:
      item.diagram_svg !== null && item.diagram_alt_text !== null
        ? { svgMarkup: item.diagram_svg, altText: item.diagram_alt_text }
        : null,
  };
}
