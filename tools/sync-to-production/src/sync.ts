import type { PoolClient } from 'pg';
import {
  loadApprovedItemsForSync,
  loadObjectiveContext,
  replaceSyncedItemOptions,
  resolveHierarchyIdsByNaturalKey,
  upsertSyncedItem,
} from '@jamb/db';

/**
 * One-way, idempotent push of local Postgres's already-approved items to
 * a production database (Railway/Supabase) — the follow-up to moving
 * generation and review entirely local. Local is the authoring/review
 * source of truth; nothing here ever reads from or writes anything other
 * than approved-item content to the target, and nothing here mutates the
 * source at all.
 *
 * Deliberately additive-only, never retractive: an item approved, synced,
 * and later rejected/quarantined *locally* stays live on the target until
 * a future session adds retraction logic. Disclosed, not silently patched
 * around — see `docs/build-log.md`'s entry for this session.
 */

export interface SyncDependencies {
  source: PoolClient;
  target: PoolClient;
  now: () => Date;
}

export interface SyncResult {
  syncedLocalItemIds: number[];
}

export async function syncApprovedItems(deps: SyncDependencies): Promise<SyncResult> {
  const items = await loadApprovedItemsForSync(deps.source);
  const syncedLocalItemIds: number[] = [];

  for (const item of items) {
    // Resolved by name path, not trusted to share a numeric id with the
    // source — see `resolveHierarchyIdsByNaturalKey`'s own doc comment.
    const objectiveContext = await loadObjectiveContext(deps.source, item.objectiveId);
    const targetIds = await resolveHierarchyIdsByNaturalKey(deps.target, {
      subjectName: objectiveContext.subjectName,
      topicName: objectiveContext.topicName,
      subtopicName: objectiveContext.subtopicName,
      objectiveDescription: objectiveContext.objectiveDescription,
    });

    // The local reviewer identity has no meaning as a foreign key into the
    // target's own `users` table (upsertSyncedItem never writes
    // reviewer_id/reviewed_at) -- recorded here instead, in JSONB, purely
    // for audit.
    const provenance = {
      ...item.provenance,
      syncedFrom: {
        localItemId: item.id,
        localReviewerId: item.reviewerId,
        reviewedAt: item.reviewedAt ? item.reviewedAt.toISOString() : null,
        syncedAt: deps.now().toISOString(),
      },
    };

    const targetItemId = await upsertSyncedItem(deps.target, {
      localItemId: item.id,
      subjectId: targetIds.subjectId,
      topicId: targetIds.topicId,
      subtopicId: targetIds.subtopicId,
      objectiveId: targetIds.objectiveId,
      stem: item.stem,
      explanation: item.explanation,
      methodSteps: item.methodSteps,
      cognitiveLevel: item.cognitiveLevel,
      authorDifficulty: item.authorDifficulty,
      expectedTimeSeconds: item.expectedTimeSeconds,
      riskTier: item.riskTier,
      status: item.status,
      approvalRoute: item.approvalRoute,
      version: item.version,
      provenance,
    });

    await replaceSyncedItemOptions(deps.target, targetItemId, item.options);
    syncedLocalItemIds.push(item.id);
  }

  return { syncedLocalItemIds };
}
