import type { Pool, PoolClient } from 'pg';
import {
  computePackVersion,
  type OptionLabel,
  type SubjectPackManifestEntry,
} from '@jamb/shared';
import { pool } from './client';
import { APPROVED_STATUSES } from './content-dashboard-repository';

/**
 * Content sync's server-side pack delivery (plan 8.3, follow-up to
 * progress-sync). Reuses `APPROVED_STATUSES` (`content-dashboard-repository.ts`)
 * unchanged — the same definition of "live" already used for the content
 * lead's dashboard and the brief board's coverage counts.
 */

interface SubjectPackItemRow {
  item_id: number;
  item_version: number;
  stem: string;
  explanation: string;
  method_steps: string[];
  cognitive_level: string;
  expected_time_seconds: number;
  options: { label: OptionLabel; text: string; isCorrect: boolean; distractorRationale: string | null }[];
  svg_asset: string | null;
  alt_text: string | null;
}

export interface SubjectPackItemData {
  itemId: number;
  stem: string;
  explanation: string;
  methodSteps: string[];
  cognitiveLevel: string;
  expectedTimeSeconds: number;
  options: SubjectPackItemRow['options'];
  diagram: { svgMarkup: string; altText: string } | null;
}

/** The unsigned pack payload — `apps/api/src/index.ts`'s wiring signs it (mirrors how `auth.ts`/`candidate.ts` sign a token at the route/wiring layer, not inside packages/db). */
export interface SubjectPackData {
  subjectId: number;
  subjectName: string;
  version: string;
  items: SubjectPackItemData[];
}

function itemsQuery(): string {
  return `SELECT i.id AS item_id, i.version AS item_version, i.stem, i.explanation, i.method_steps,
                 i.cognitive_level, i.expected_time_seconds,
                 COALESCE(
                   (SELECT json_agg(json_build_object(
                              'label', o.label, 'text', o.option_text,
                              'isCorrect', o.is_correct, 'distractorRationale', o.distractor_rationale
                            ) ORDER BY o.label)
                      FROM item_options o WHERE o.item_id = i.id),
                   '[]'::json
                 ) AS options,
                 it.svg_asset, it.alt_text
            FROM items i
            LEFT JOIN illustration_tickets it ON it.item_id = i.id AND it.status = 'completed'
           WHERE i.subject_id = $1 AND i.status = ANY($2)
           ORDER BY i.id`;
}

function toItemData(row: SubjectPackItemRow): SubjectPackItemData {
  return {
    itemId: row.item_id,
    stem: row.stem,
    explanation: row.explanation,
    methodSteps: row.method_steps,
    cognitiveLevel: row.cognitive_level,
    expectedTimeSeconds: row.expected_time_seconds,
    options: row.options,
    diagram:
      row.svg_asset !== null && row.alt_text !== null
        ? { svgMarkup: row.svg_asset, altText: row.alt_text }
        : null,
  };
}

/** One manifest entry per subject with at least one approved item. */
export async function listAvailableSubjectPacks(client?: PoolClient): Promise<SubjectPackManifestEntry[]> {
  const runner: Pool | PoolClient = client ?? pool;

  const result = await runner.query<{ subject_id: number; subject_name: string; item_id: number; item_version: number }>(
    `SELECT s.id AS subject_id, s.name AS subject_name, i.id AS item_id, i.version AS item_version
       FROM items i
       JOIN subjects s ON s.id = i.subject_id
      WHERE i.status = ANY($1)`,
    [APPROVED_STATUSES],
  );

  const bySubject = new Map<number, { subjectName: string; items: { itemId: number; version: number }[] }>();
  for (const row of result.rows) {
    const entry = bySubject.get(row.subject_id) ?? { subjectName: row.subject_name, items: [] };
    entry.items.push({ itemId: row.item_id, version: row.item_version });
    bySubject.set(row.subject_id, entry);
  }

  return [...bySubject.entries()]
    .map(([subjectId, entry]) => ({
      subjectId,
      subjectName: entry.subjectName,
      version: computePackVersion(entry.items),
      itemCount: entry.items.length,
    }))
    .sort((a, b) => a.subjectId - b.subjectId);
}

/** Null when the subject has no approved items (including an unknown subject id) -- both look the same from a candidate's perspective: nothing to download. */
export async function loadSubjectPack(subjectId: number, client?: PoolClient): Promise<SubjectPackData | null> {
  const runner: Pool | PoolClient = client ?? pool;

  const subjectResult = await runner.query<{ name: string }>(`SELECT name FROM subjects WHERE id = $1`, [
    subjectId,
  ]);
  const subject = subjectResult.rows[0];
  if (!subject) {
    return null;
  }

  const itemsResult = await runner.query<SubjectPackItemRow>(itemsQuery(), [subjectId, APPROVED_STATUSES]);
  if (itemsResult.rows.length === 0) {
    return null;
  }

  return {
    subjectId,
    subjectName: subject.name,
    version: computePackVersion(itemsResult.rows.map((row) => ({ itemId: row.item_id, version: row.item_version }))),
    items: itemsResult.rows.map(toItemData),
  };
}
