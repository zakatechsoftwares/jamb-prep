import type { PoolClient } from 'pg';
import type { ApprovalRoute, RiskTier } from '@jamb/shared';
import { firstRow } from './first-row';

/**
 * Local-to-production sync's own database access (follow-up to the
 * subscription-CLI migration, `docs/build-log.md`) — local Postgres is now
 * the authoring/review source of truth; this is the one-way, idempotent
 * push of already-approved items to the production (Railway/Supabase)
 * database. Lives here, not in `tools/sync-to-production`, matching this
 * repo's "database access through the repository layer only" convention —
 * the same reason `item-generation-repository.ts` holds `tools/item-gen`'s
 * SQL rather than that tool writing it directly.
 */

const APPROVED_STATUSES_FOR_SYNC = ['approved_uncalibrated', 'approved_calibrated'];

export interface SyncOptionRow {
  label: 'A' | 'B' | 'C' | 'D';
  text: string;
  isCorrect: boolean;
  distractorRationale: string | null;
}

export interface ApprovedItemForSync {
  id: number;
  objectiveId: number;
  stem: string;
  explanation: string;
  methodSteps: string[];
  cognitiveLevel: string;
  authorDifficulty: number | null;
  expectedTimeSeconds: number;
  riskTier: RiskTier;
  provenance: Record<string, unknown>;
  version: number;
  status: string;
  approvalRoute: ApprovalRoute | null;
  /** Never copied to the target row — see `upsertSyncedItem`'s own doc comment. Carried here only so the orchestrator can fold it into an audit note. */
  reviewerId: number | null;
  reviewedAt: Date | null;
  options: SyncOptionRow[];
}

/** Every item currently in an approved status on the source database, with its options. Re-selected on every run — no incremental/delta tracking, proportionate at today's item counts, matching this repo's other "full replace" precedents. */
export async function loadApprovedItemsForSync(client: PoolClient): Promise<ApprovedItemForSync[]> {
  const itemsResult = await client.query<{
    id: number;
    objective_id: number;
    stem: string;
    explanation: string;
    method_steps: string[];
    cognitive_level: string;
    author_difficulty: string | null;
    expected_time_seconds: number;
    risk_tier: RiskTier;
    provenance: Record<string, unknown>;
    version: number;
    status: string;
    approval_route: ApprovalRoute | null;
    reviewer_id: number | null;
    reviewed_at: Date | null;
  }>(
    `SELECT id, objective_id, stem, explanation, method_steps, cognitive_level,
            author_difficulty, expected_time_seconds, risk_tier, provenance,
            version, status, approval_route, reviewer_id, reviewed_at
       FROM items
      WHERE status = ANY($1)
      ORDER BY id`,
    [APPROVED_STATUSES_FOR_SYNC],
  );

  const itemIds = itemsResult.rows.map((row) => row.id);
  const optionsResult = await client.query<{
    item_id: number;
    label: 'A' | 'B' | 'C' | 'D';
    option_text: string;
    is_correct: boolean;
    distractor_rationale: string | null;
  }>(
    `SELECT item_id, label, option_text, is_correct, distractor_rationale
       FROM item_options
      WHERE item_id = ANY($1)`,
    [itemIds],
  );

  const optionsByItemId = new Map<number, SyncOptionRow[]>();
  for (const row of optionsResult.rows) {
    const list = optionsByItemId.get(row.item_id) ?? [];
    list.push({
      label: row.label,
      text: row.option_text,
      isCorrect: row.is_correct,
      distractorRationale: row.distractor_rationale,
    });
    optionsByItemId.set(row.item_id, list);
  }

  return itemsResult.rows.map((row) => ({
    id: row.id,
    objectiveId: row.objective_id,
    stem: row.stem,
    explanation: row.explanation,
    methodSteps: row.method_steps,
    cognitiveLevel: row.cognitive_level,
    authorDifficulty: row.author_difficulty === null ? null : Number(row.author_difficulty),
    expectedTimeSeconds: row.expected_time_seconds,
    riskTier: row.risk_tier,
    provenance: row.provenance,
    version: row.version,
    status: row.status,
    approvalRoute: row.approval_route,
    reviewerId: row.reviewer_id,
    reviewedAt: row.reviewed_at,
    options: optionsByItemId.get(row.id) ?? [],
  }));
}

export interface ObjectiveNaturalKey {
  subjectName: string;
  topicName: string;
  subtopicName: string;
  objectiveDescription: string;
}

export class ObjectiveNotFoundByNaturalKeyError extends Error {
  constructor(public readonly key: ObjectiveNaturalKey) {
    super(
      `No matching objective on the target database for ${key.subjectName} > ${key.topicName} > ${key.subtopicName} > "${key.objectiveDescription}"`,
    );
    this.name = 'ObjectiveNotFoundByNaturalKeyError';
  }
}

export interface ResolvedHierarchyIds {
  subjectId: number;
  topicId: number;
  subtopicId: number;
  objectiveId: number;
}

/**
 * The target-side counterpart to `loadObjectiveContext`'s id-based lookup
 * — resolves by name path instead, since two independently-seeded
 * databases cannot be trusted to share numeric ids for the same
 * conceptual objective. Throws loudly on a miss rather than guessing or
 * silently skipping — a missing objective on the target is a real
 * data-consistency problem between the two databases, not something to
 * paper over.
 */
export async function resolveHierarchyIdsByNaturalKey(
  client: PoolClient,
  key: ObjectiveNaturalKey,
): Promise<ResolvedHierarchyIds> {
  const result = await client.query<{
    subject_id: number;
    topic_id: number;
    subtopic_id: number;
    objective_id: number;
  }>(
    `SELECT s.id AS subject_id, t.id AS topic_id, st.id AS subtopic_id, o.id AS objective_id
       FROM objectives o
       JOIN subtopics st ON st.id = o.subtopic_id
       JOIN topics t ON t.id = st.topic_id
       JOIN subjects s ON s.id = t.subject_id
      WHERE s.name = $1 AND t.name = $2 AND st.name = $3 AND o.description = $4`,
    [key.subjectName, key.topicName, key.subtopicName, key.objectiveDescription],
  );

  const row = result.rows[0];
  if (!row) {
    throw new ObjectiveNotFoundByNaturalKeyError(key);
  }
  return {
    subjectId: row.subject_id,
    topicId: row.topic_id,
    subtopicId: row.subtopic_id,
    objectiveId: row.objective_id,
  };
}

export interface UpsertSyncedItemInput {
  localItemId: number;
  subjectId: number;
  topicId: number;
  subtopicId: number;
  objectiveId: number;
  stem: string;
  explanation: string;
  methodSteps: string[];
  cognitiveLevel: string;
  authorDifficulty: number | null;
  expectedTimeSeconds: number;
  riskTier: RiskTier;
  status: string;
  approvalRoute: ApprovalRoute | null;
  version: number;
  provenance: Record<string, unknown>;
}

/**
 * Idempotent upsert keyed on `items.external_ref` (`'local:' + localItemId`)
 * — that column already exists exactly for this ("stable external key...
 * so imports and the seed script can upsert idempotently",
 * `migrations/0005_items.up.sql`; `seed.ts` already uses it this way).
 *
 * The `DO UPDATE SET` column list is deliberately split: content columns
 * (stem, explanation, options, provenance, version, …) are always
 * overwritten, but `status`/`approval_route`/`reviewer_id`/`reviewed_at`
 * are never referenced in it at all — not even via `COALESCE` — so a
 * re-sync can never undo whatever the target database's own live quality
 * gates (e.g. the accuracy-threshold sweep's quarantine rule) have since
 * done to that row. `reviewer_id`/`reviewed_at` are never written on
 * *either* path (absent from the INSERT column list too): the source's
 * local reviewer id has no meaning as a foreign key into the target's own
 * `users` table.
 */
export async function upsertSyncedItem(
  client: PoolClient,
  input: UpsertSyncedItemInput,
): Promise<number> {
  const externalRef = `local:${input.localItemId}`;
  return firstRow(
    await client.query<{ id: number }>(
      `INSERT INTO items (
         subject_id, topic_id, subtopic_id, objective_id,
         stem, explanation, method_steps, cognitive_level,
         author_difficulty, expected_time_seconds, risk_tier,
         status, approval_route, version, provenance, external_ref
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (external_ref) DO UPDATE SET
         subject_id = EXCLUDED.subject_id,
         topic_id = EXCLUDED.topic_id,
         subtopic_id = EXCLUDED.subtopic_id,
         objective_id = EXCLUDED.objective_id,
         stem = EXCLUDED.stem,
         explanation = EXCLUDED.explanation,
         method_steps = EXCLUDED.method_steps,
         cognitive_level = EXCLUDED.cognitive_level,
         author_difficulty = EXCLUDED.author_difficulty,
         expected_time_seconds = EXCLUDED.expected_time_seconds,
         risk_tier = EXCLUDED.risk_tier,
         version = EXCLUDED.version,
         provenance = EXCLUDED.provenance
       RETURNING id`,
      [
        input.subjectId,
        input.topicId,
        input.subtopicId,
        input.objectiveId,
        input.stem,
        input.explanation,
        input.methodSteps,
        input.cognitiveLevel,
        input.authorDifficulty,
        input.expectedTimeSeconds,
        input.riskTier,
        input.status,
        input.approvalRoute,
        input.version,
        JSON.stringify(input.provenance),
        externalRef,
      ],
    ),
  ).id;
}

/**
 * Full delete-then-reinsert, matching this codebase's existing "a
 * redownload is always a full replace" precedent (`saveSubjectPack`) —
 * options are cheap (4 rows) and have no independent history worth
 * preserving across a re-sync.
 */
export async function replaceSyncedItemOptions(
  client: PoolClient,
  itemId: number,
  options: SyncOptionRow[],
): Promise<void> {
  await client.query(`DELETE FROM item_options WHERE item_id = $1`, [itemId]);
  for (const option of options) {
    await client.query(
      `INSERT INTO item_options (item_id, label, option_text, is_correct, distractor_rationale)
       VALUES ($1, $2, $3, $4, $5)`,
      [itemId, option.label, option.text, option.isCorrect, option.distractorRationale],
    );
  }
}
