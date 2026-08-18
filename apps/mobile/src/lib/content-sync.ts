import type { SubjectPackManifest } from '@jamb/shared';
import {
  loadLocalCandidate,
  loadLocalContentVersion,
  saveActiveExamConfigId,
  saveSubjectPack,
} from './database';
import { downloadPack, listAvailablePacks } from './content-pack-api-client';

/**
 * Content sync (plan 8.3's server-to-device half, follow-up to progress
 * sync) — downloads a subject's approved items when the server's version
 * differs from what's stored locally, replacing the whole subject rather
 * than diffing it (a simplified stand-in for the plan's "requests deltas"
 * language, proportionate at today's item counts).
 *
 * Deliberately not "signed, encrypted bundles" the way plan 8.3 describes:
 * an HMAC signature the client verifies would need the same secret
 * embedded in the app bundle, which is not a real integrity check (see
 * `content-pack-policy.ts`'s doc comment on `SubjectPack`). The actual
 * protection here is what it honestly is — HTTPS transport plus an
 * authenticated download — not a fabricated cryptographic guarantee.
 *
 * This app's Mock CBT demo (`useMockSession.ts`) is untouched and keeps
 * running on `demo-fixture.ts` — only the new Practice mode
 * (`usePractice.ts`) consumes what this downloads.
 */
export async function downloadAvailablePacks(): Promise<void> {
  const candidate = await loadLocalCandidate();
  if (!candidate) {
    return;
  }

  let manifest: SubjectPackManifest;
  try {
    manifest = await listAvailablePacks(candidate.token);
  } catch {
    return;
  }

  if (manifest.activeExamConfigId !== null) {
    await saveActiveExamConfigId(manifest.activeExamConfigId);
  }

  for (const entry of manifest.packs) {
    try {
      const localVersion = await loadLocalContentVersion(entry.subjectId);
      if (localVersion === entry.version) {
        continue;
      }

      const pack = await downloadPack(candidate.token, entry.subjectId);
      await saveSubjectPack(pack);
    } catch {
      // Best-effort, per subject: one subject failing to download must not
      // stop the others, and never blocks anything else in the app (rule 1).
    }
  }
}
