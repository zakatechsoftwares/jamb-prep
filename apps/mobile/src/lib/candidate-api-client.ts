import type {
  AttemptUploadPayload,
  EndCandidateSessionInput,
  RegisterCandidateInput,
  ScoreResult,
  StartCandidateSessionInput,
} from '@jamb/shared';

/**
 * A thin fetch wrapper for the five `/candidate/*` routes `apps/api`
 * exposes (progress sync, plan 8.3). `EXPO_PUBLIC_API_BASE_URL` is Expo's
 * own convention for a client-exposed env var, inlined at bundle time --
 * unset in local dev, `localhost` is assumed (an Android emulator needs
 * `10.0.2.2` instead; a real on-device walkthrough is still owed, per
 * this app's own build-log entries, and would need this set explicitly).
 */
const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';

async function postJson<T>(path: string, token: string | null, body: unknown): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`POST ${path} failed with status ${response.status}`);
  }
  return (await response.json()) as T;
}

export function registerCandidate(input: RegisterCandidateInput): Promise<{
  token: string;
  userId: number;
}> {
  return postJson('/candidate/register', null, input);
}

export function startCandidateSession(
  token: string,
  input: StartCandidateSessionInput,
): Promise<{ sessionId: number }> {
  return postJson('/candidate/sessions', token, input);
}

export function recordCandidateAttempt(
  token: string,
  sessionId: number,
  input: AttemptUploadPayload,
): Promise<{ attemptId: number }> {
  return postJson(`/candidate/sessions/${sessionId}/attempts`, token, input);
}

/** `null` for a practice session — see `CandidateSyncService.endSession`'s own doc comment. */
export function endCandidateSession(
  token: string,
  sessionId: number,
  input: EndCandidateSessionInput,
): Promise<ScoreResult | null> {
  return postJson(`/candidate/sessions/${sessionId}/end`, token, input);
}
