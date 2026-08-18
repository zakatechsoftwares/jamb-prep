import { buildAttemptUploadPayloads, generateSyncId } from '@jamb/shared';
import {
  loadLocalCandidate,
  loadLocalProgressEvents,
  loadSessionsNeedingSync,
  markSessionSynced,
  saveLocalCandidate,
} from './database';
import {
  endCandidateSession,
  recordCandidateAttempt,
  registerCandidate,
  startCandidateSession,
} from './candidate-api-client';

/**
 * Progress sync orchestration (plan 8.3, follow-up to session 12). Nothing
 * here is a prerequisite for practising, sitting, or scoring a mock — rule
 * 1 means both `ensureRegistered` and `syncPendingSessions` are opt-in and
 * best-effort. No connectivity-detection library is used: a failed fetch
 * just leaves a session's `sync_state` unchanged, and the next trigger
 * (another session ending, or the next app launch) retries the whole
 * sequence again.
 */

/** Registers this device once, if it hasn't been already. A no-op on every later call. */
export async function ensureRegistered(fullName: string, phone: string, examYear: number): Promise<void> {
  const existing = await loadLocalCandidate();
  if (existing) {
    return;
  }

  const deviceId = generateSyncId(Math.random);
  const { token, userId } = await registerCandidate({ fullName, phone, examYear });
  await saveLocalCandidate(userId, token, deviceId);
}

/**
 * Retries every finished, not-yet-synced session in full, relying on
 * `startSession`/`recordAttempt` already being idempotent server-side
 * rather than tracking partial upload progress locally -- re-sending an
 * already-uploaded attempt is a safe no-op, not a double count.
 */
export async function syncPendingSessions(): Promise<void> {
  const candidate = await loadLocalCandidate();
  if (!candidate) {
    return;
  }

  const sessions = await loadSessionsNeedingSync();
  for (const session of sessions) {
    try {
      const { sessionId: serverSessionId } = await startCandidateSession(candidate.token, {
        clientSessionId: session.clientSessionId,
        examConfigId: session.examConfigId,
        mode: session.mode,
        deviceId: candidate.deviceId,
        startedAt: session.startedAt.toISOString(),
      });

      const events = await loadLocalProgressEvents(session.sessionId);
      const payloads = buildAttemptUploadPayloads(session.startedAt, events);
      for (const payload of payloads) {
        await recordCandidateAttempt(candidate.token, serverSessionId, payload);
      }

      if (session.endedAt) {
        await endCandidateSession(candidate.token, serverSessionId, {
          endedAt: session.endedAt.toISOString(),
        });
      }

      await markSessionSynced(session.sessionId, serverSessionId);
    } catch {
      // Best-effort: this session's sync_state stays as it was, and the
      // next call to syncPendingSessions retries it from the top.
    }
  }
}
