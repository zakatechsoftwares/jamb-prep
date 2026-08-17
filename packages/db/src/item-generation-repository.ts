import type { PoolClient } from 'pg';
import {
  transition,
  type IndependentSolveVerdict,
  type ItemFacts,
  type LifecycleEvent,
  type OptionLabel,
  type RiskTier,
  type TransitionResult,
} from '@jamb/shared';
import { firstRow } from './first-row';
import { recordTransition } from './review-queue-repository';

/**
 * The item-generation pipeline's own database access (item-generation-spec.md,
 * plan 7.4) — every SQL statement the pipeline needs lives here, none of it
 * in `tools/item-gen`, the same discipline the rest of this codebase holds
 * to ("database access through the repository layer only").
 */

export interface ObjectiveContext {
  objectiveId: number;
  objectiveDescription: string;
  subtopicId: number;
  subtopicName: string;
  topicId: number;
  topicName: string;
  subjectId: number;
  subjectName: string;
}

export async function loadObjectiveContext(
  client: PoolClient,
  objectiveId: number,
): Promise<ObjectiveContext> {
  const result = await client.query<{
    objective_id: number;
    objective_description: string;
    subtopic_id: number;
    subtopic_name: string;
    topic_id: number;
    topic_name: string;
    subject_id: number;
    subject_name: string;
  }>(
    `SELECT o.id AS objective_id, o.description AS objective_description,
            st.id AS subtopic_id, st.name AS subtopic_name,
            t.id AS topic_id, t.name AS topic_name,
            s.id AS subject_id, s.name AS subject_name
       FROM objectives o
       JOIN subtopics st ON st.id = o.subtopic_id
       JOIN topics t ON t.id = st.topic_id
       JOIN subjects s ON s.id = t.subject_id
      WHERE o.id = $1`,
    [objectiveId],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error(`loadObjectiveContext: no objective with id ${objectiveId}`);
  }

  return {
    objectiveId: row.objective_id,
    objectiveDescription: row.objective_description,
    subtopicId: row.subtopic_id,
    subtopicName: row.subtopic_name,
    topicId: row.topic_id,
    topicName: row.topic_name,
    subjectId: row.subject_id,
    subjectName: row.subject_name,
  };
}

export interface GeneratedOptionInsert {
  label: OptionLabel;
  text: string;
  isCorrect: boolean;
  distractorRationale: string | null;
}

export interface GeneratedItemInsert {
  subjectId: number;
  topicId: number;
  subtopicId: number;
  objectiveId: number;
  stem: string;
  explanation: string;
  methodSteps: string[];
  cognitiveLevel: string;
  authorDifficulty: number;
  expectedTimeSeconds: number;
  /** 'not_generated' only for a contributor-authored item — never derived at generation. */
  riskTier: RiskTier;
  /** 'not_run' for an item that skipped the solve call because it was already headed to gate_failed. */
  independentSolveVerdict: IndependentSolveVerdict;
  sampledForReview: boolean;
  /** Null for an item that skipped embedding because it was already headed to gate_failed on schema grounds. */
  stemEmbedding: number[] | null;
  /** Null for a contributor-authored item — it was never an inference call at all (migration 0017). */
  inferenceCostUsd: number | null;
  /** Model, prompt version, generation timestamp, raw-response reference — plan 7.6. */
  provenance: Record<string, unknown>;
  options: GeneratedOptionInsert[];
  /** Non-null only for a contributor-authored item (plan 7.12, session 11) — null for every generated item. */
  contributorId: number | null;
  /** Non-null only for a contributor-authored item submitted against a brief. */
  briefId: number | null;
}

/**
 * Inserts one item and its four options, always with status 'generated'.
 * Despite the name, this is shared by both the generation pipeline
 * (`contributorId`/`briefId` null) and the contributor brief board
 * (`brief-repository.ts`, both set) — the row shape and insert order are
 * identical either way, only the origin fields differ.
 */
export async function insertGeneratedItem(
  client: PoolClient,
  draft: GeneratedItemInsert,
): Promise<number> {
  const itemId = firstRow(
    await client.query<{ id: number }>(
      `INSERT INTO items (
         subject_id, topic_id, subtopic_id, objective_id,
         stem, explanation, method_steps, cognitive_level,
         author_difficulty, expected_time_seconds,
         risk_tier, independent_solve_verdict, sampled_for_review,
         stem_embedding, inference_cost_usd, provenance,
         contributor_id, brief_id, status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, 'generated')
       RETURNING id`,
      [
        draft.subjectId,
        draft.topicId,
        draft.subtopicId,
        draft.objectiveId,
        draft.stem,
        draft.explanation,
        draft.methodSteps,
        draft.cognitiveLevel,
        draft.authorDifficulty,
        draft.expectedTimeSeconds,
        draft.riskTier,
        draft.independentSolveVerdict,
        draft.sampledForReview,
        draft.stemEmbedding,
        draft.inferenceCostUsd,
        JSON.stringify(draft.provenance),
        draft.contributorId,
        draft.briefId,
      ],
    ),
  ).id;

  for (const option of draft.options) {
    await client.query(
      `INSERT INTO item_options (item_id, label, option_text, is_correct, distractor_rationale)
       VALUES ($1, $2, $3, $4, $5)`,
      [itemId, option.label, option.text, option.isCorrect, option.distractorRationale],
    );
  }

  return itemId;
}

export interface EmbeddingCandidate {
  itemId: number;
  stemEmbedding: number[];
}

/**
 * Every embedded item in the subject that could still legitimately be
 * duplicated against — everything except `rejected`/`retired`, the two
 * terminal states nothing should be compared against (item-generation-spec.md
 * §3.3: "against the live bank", read here as "against anything not already
 * dead"). An item with no embedding (pre-dates this migration, or is
 * human-authored) is silently excluded rather than treated as a non-match.
 */
export async function loadLiveBankEmbeddings(
  client: PoolClient,
  subjectId: number,
): Promise<EmbeddingCandidate[]> {
  const result = await client.query<{ id: number; stem_embedding: number[] | null }>(
    `SELECT id, stem_embedding FROM items
      WHERE subject_id = $1
        AND stem_embedding IS NOT NULL
        AND status NOT IN ('rejected', 'retired')`,
    [subjectId],
  );

  return result.rows
    .filter((row): row is { id: number; stem_embedding: number[] } => row.stem_embedding !== null)
    .map((row) => ({ itemId: row.id, stemEmbedding: row.stem_embedding }));
}

/**
 * Advances one generated item through the state machine (plan 7.10) — the
 * only way any item in this pipeline changes status. Same shape as
 * `accuracy-threshold-sweep.ts`'s `applyRequeueTransition`: `transition()`
 * decides the result, then one `items` UPDATE and one `item_state_transitions`
 * INSERT record it, for a `'system'` actor. Used identically whether the
 * event is `auto_gate_promote` or `gates_passed` — same two queries either
 * way — which is what keeps a sampled and an unsampled item indistinguishable
 * downstream except for the routing decision itself (session 09's timing
 * convention, applied here: nothing about *how much work* this function does
 * depends on which branch fired).
 */
export async function promoteGeneratedItem(
  client: PoolClient,
  itemId: number,
  itemFacts: ItemFacts,
  event: LifecycleEvent,
  occurredAt: Date,
): Promise<TransitionResult> {
  const systemActor = { userId: null, role: 'system' as const };
  const result = transition('generated', event, {
    item: itemFacts,
    actor: systemActor,
    occurredAt,
    priorDecisions: [],
  });

  await client.query(
    `UPDATE items SET status = $2, approval_route = COALESCE($3, approval_route) WHERE id = $1`,
    [itemId, result.status, result.approvalRoute],
  );

  await recordTransition(
    client,
    itemId,
    'generated',
    result.status,
    event.type,
    result.actorUserId,
    'system',
    result.occurredAt,
    result.approvalRoute,
  );

  return result;
}
