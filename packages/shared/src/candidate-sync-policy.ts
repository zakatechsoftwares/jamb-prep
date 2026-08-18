import type { OptionLabel } from './item-lifecycle';
import type { ScoreResult } from './scoring';

/**
 * The candidate progress-sync wire shapes and service contract `apps/api`'s
 * candidate routes need (plan 8.3, follow-up to canonical session 12) —
 * declared here, the same way `ReviewQueueService`/`BriefBoardService`
 * already are, so the API layer can be wired against it without importing
 * the database at module load, and `apps/mobile` can share the same types.
 *
 * Every method takes the candidate's `users.id`, resolved by the route from
 * the bearer token (`candidate-tokens.ts`) — never accepted from the
 * request body, the same identity discipline `BriefBoardService` already
 * established for reviewers.
 */

export interface RegisterCandidateInput {
  fullName: string;
  phone: string;
  examYear: number;
}

export interface RegisterCandidateResult {
  userId: number;
}

export interface StartCandidateSessionInput {
  clientSessionId: string;
  examConfigId: number;
  mode: 'practice' | 'mock';
  deviceId: string;
  /** ISO 8601 on the wire. */
  startedAt: string;
}

export interface RecordCandidateAttemptInput {
  itemId: number;
  chosenOption: OptionLabel;
  secondsTaken: number;
  flagged: boolean;
  /** ISO 8601 on the wire. */
  answeredAt: string;
  idempotencyKey: string;
}

export interface EndCandidateSessionInput {
  /** ISO 8601 on the wire. */
  endedAt: string;
}

export interface CandidateSessionAttemptSummary {
  itemId: number;
  subjectId: number;
  chosenOption: OptionLabel;
  isCorrect: boolean;
  secondsTaken: number;
  flagged: boolean;
  /** ISO 8601 on the wire. */
  answeredAt: string;
  sequence: number;
}

export interface CandidateSessionResumeResult {
  sessionId: number;
  startedAt: string;
  endedAt: string | null;
  examConfigId: number;
  attempts: CandidateSessionAttemptSummary[];
}

/**
 * One row from the mobile app's local, append-only progress log (a
 * select_option or toggle_flag event) — `chosenOption` is null for a
 * flag-only event, mirroring `local_attempts`' own shape.
 */
export interface LocalProgressEvent {
  itemId: number;
  chosenOption: OptionLabel | null;
  flagged: boolean;
  occurredAt: Date;
  idempotencyKey: string;
}

export interface AttemptUploadPayload {
  itemId: number;
  chosenOption: OptionLabel;
  /** Derived, not measured — see buildAttemptUploadPayloads' doc comment. */
  secondsTaken: number;
  flagged: boolean;
  /** ISO 8601. */
  answeredAt: string;
  idempotencyKey: string;
}

/**
 * Maps a session's local progress log into the payloads
 * `/candidate/sessions/:id/attempts` expects. The mobile app has no
 * per-question stopwatch — `secondsTaken` is derived as the elapsed time
 * since the previous event in the session (or since the session started,
 * for the first event), which is what's actually available from persisted
 * timestamps. This is a proxy, not a measurement: nothing today reads
 * `attempts.seconds_taken` back for scoring (`ScoringAttempt` doesn't
 * include it at all), so a rough proxy is honest about what it is rather
 * than fabricating false precision.
 *
 * `events` must be ordered `occurredAt` ascending (the same order
 * `local_attempts`' own `id ASC` ordering already produces) — the elapsed
 * clock advances across *every* event, including a flag-only one, but only
 * an event with a real `chosenOption` produces an upload payload, since
 * that is the only thing the server's `recordAttempt` accepts.
 */
export function buildAttemptUploadPayloads(
  sessionStartedAt: Date,
  events: LocalProgressEvent[],
): AttemptUploadPayload[] {
  const payloads: AttemptUploadPayload[] = [];
  let previous = sessionStartedAt;

  for (const event of events) {
    const secondsTaken = Math.max(0, Math.round((event.occurredAt.getTime() - previous.getTime()) / 1000));
    previous = event.occurredAt;

    if (event.chosenOption !== null) {
      payloads.push({
        itemId: event.itemId,
        chosenOption: event.chosenOption,
        secondsTaken,
        flagged: event.flagged,
        answeredAt: event.occurredAt.toISOString(),
        idempotencyKey: event.idempotencyKey,
      });
    }
  }

  return payloads;
}

export interface CandidateSyncService {
  register(input: RegisterCandidateInput): Promise<RegisterCandidateResult>;
  startSession(
    candidateUserId: number,
    input: StartCandidateSessionInput,
  ): Promise<{ sessionId: number }>;
  recordAttempt(
    candidateUserId: number,
    sessionId: number,
    input: RecordCandidateAttemptInput,
  ): Promise<{ attemptId: number }>;
  endSession(
    candidateUserId: number,
    sessionId: number,
    input: EndCandidateSessionInput,
  ): Promise<ScoreResult>;
  resumeSession(
    candidateUserId: number,
    clientSessionId: string,
  ): Promise<CandidateSessionResumeResult | null>;
}
