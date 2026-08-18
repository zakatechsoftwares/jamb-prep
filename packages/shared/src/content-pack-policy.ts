import type { OptionLabel } from './item-lifecycle';

/**
 * Content sync (plan 8.3, server-to-device half — the follow-up to
 * progress-sync's device-to-server half) wire shapes and service contract,
 * following the `BriefBoardService`/`CandidateSyncService` pattern: declared
 * here so `apps/api` can be wired against it without importing the database
 * at module load, and `apps/mobile` shares the same types.
 */

/**
 * A deterministic version fingerprint for one subject's approved item set —
 * not a cryptographic hash, deliberately: `packages/shared` is imported by
 * `apps/mobile`'s Hermes runtime, where `node:crypto` isn't available (the
 * same constraint `sync-ids.ts`'s `generateSyncId` already works around).
 * Sorting by `itemId` first makes the result independent of query order;
 * separating both structurally (a real delimiter, not concatenation) and
 * per-pair (comma) avoids two different sets ever producing the same
 * string through naive digit-boundary collisions (e.g. item 1 v12 vs item
 * 11 v2). Changes automatically whenever an item is added, removed, or
 * edited (`items.version` bumps on `edit_and_approve`) — no call site
 * anywhere has to remember to bump a separate counter.
 */
export function computePackVersion(items: { itemId: number; version: number }[]): string {
  return items
    .slice()
    .sort((a, b) => a.itemId - b.itemId)
    .map((item) => `${item.itemId}:${item.version}`)
    .join(',');
}

export interface SubjectPackOption {
  label: OptionLabel;
  text: string;
  isCorrect: boolean;
  distractorRationale: string | null;
}

/**
 * `options` carries `isCorrect`/`distractorRationale` on purpose, unlike
 * `ReviewQueueItem` — a candidate practising is not adversarial the way a
 * reviewer being scored is (7.10/7.11's blind-solve concern), and plan
 * 6.1's Practice mode requires "immediate feedback... after each item"
 * fully offline, which needs the key on-device.
 */
export interface SubjectPackItem {
  itemId: number;
  stem: string;
  explanation: string;
  methodSteps: string[];
  cognitiveLevel: string;
  expectedTimeSeconds: number;
  options: SubjectPackOption[];
  diagram: { svgMarkup: string; altText: string } | null;
}

export interface SubjectPackManifestEntry {
  subjectId: number;
  subjectName: string;
  version: string;
  itemCount: number;
}

export interface SubjectPackManifest {
  /**
   * Null when nothing is marked active yet. A Practice session (single
   * subject, no `subject_combination`) still needs a real `exam_configs`
   * row to satisfy `sessions.exam_config_id`'s `NOT NULL` foreign key —
   * this is the one place the client learns a valid id, without needing
   * `loadExamConfigForUser`'s full blueprint resolution at all.
   */
  activeExamConfigId: number | null;
  packs: SubjectPackManifestEntry[];
}

/**
 * No `signature` field, despite plan 8.3's "signed... bundles" language —
 * caught during implementation, not shipped: HMAC is symmetric, so a
 * client-side verifier would need the same secret embedded in the app
 * bundle, which anyone could extract and use to forge a pack just as
 * easily as the server signs one. That is not an integrity check, it is
 * the appearance of one. Real client-verifiable signing needs asymmetric
 * crypto (a private key server-side, a public key safe to embed on-device)
 * and a Hermes-compatible verify path — real work, not a small addition,
 * and disproportionate for 94 items serving no paying users yet. The
 * actual integrity story for now is what it honestly is: HTTPS transport
 * plus an authenticated download. Revisit if/when device-bound
 * encryption-at-rest (the other deferred piece) is ever built for real.
 */
export interface SubjectPack {
  subjectId: number;
  subjectName: string;
  version: string;
  items: SubjectPackItem[];
}

export interface ContentPackService {
  listAvailablePacks(): Promise<SubjectPackManifest>;
  downloadPack(subjectId: number): Promise<SubjectPack | null>;
}
