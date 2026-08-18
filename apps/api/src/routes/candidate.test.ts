import { afterAll, describe, expect, it } from 'vitest';
import type { CandidateSessionResumeResult, CandidateSyncService } from '@jamb/shared';
import { signCandidateToken } from '@jamb/db/candidate-tokens';
import { createApp } from '../app';

process.env.CANDIDATE_SESSION_SECRET ??= 'test-secret-do-not-use-in-prod';

function authHeader(userId: number) {
  const token = signCandidateToken({ userId }, process.env.CANDIDATE_SESSION_SECRET!, new Date(), 60);
  return { Authorization: `Bearer ${token}` };
}

const VALID_REGISTER = { fullName: 'Ada Candidate', phone: '08012345678', examYear: 2027 };
const VALID_START_SESSION = {
  clientSessionId: 'client-session-1',
  examConfigId: 7,
  mode: 'mock',
  deviceId: 'device-1',
  startedAt: '2026-08-19T08:00:00.000Z',
};
const VALID_ATTEMPT = {
  itemId: 42,
  chosenOption: 'A',
  secondsTaken: 30,
  flagged: false,
  answeredAt: '2026-08-19T08:01:00.000Z',
  idempotencyKey: 'attempt-1',
};

interface Recorded {
  registerCalls: unknown[];
  startSessionCalls: { candidateUserId: number; input: unknown }[];
  recordAttemptCalls: { candidateUserId: number; sessionId: number; input: unknown }[];
  endSessionCalls: { candidateUserId: number; sessionId: number; input: unknown }[];
  resumeCalls: { candidateUserId: number; clientSessionId: string }[];
}

function startApp(service: Partial<CandidateSyncService>): {
  url: string;
  close: () => void;
  recorded: Recorded;
} {
  const recorded: Recorded = {
    registerCalls: [],
    startSessionCalls: [],
    recordAttemptCalls: [],
    endSessionCalls: [],
    resumeCalls: [],
  };

  const app = createApp({
    candidateSync: {
      register: (input) => {
        recorded.registerCalls.push(input);
        return service.register?.(input) ?? Promise.resolve({ userId: 1 });
      },
      startSession: (candidateUserId, input) => {
        recorded.startSessionCalls.push({ candidateUserId, input });
        return service.startSession?.(candidateUserId, input) ?? Promise.resolve({ sessionId: 1 });
      },
      recordAttempt: (candidateUserId, sessionId, input) => {
        recorded.recordAttemptCalls.push({ candidateUserId, sessionId, input });
        return (
          service.recordAttempt?.(candidateUserId, sessionId, input) ?? Promise.resolve({ attemptId: 1 })
        );
      },
      endSession: (candidateUserId, sessionId, input) => {
        recorded.endSessionCalls.push({ candidateUserId, sessionId, input });
        return (
          service.endSession?.(candidateUserId, sessionId, input) ??
          Promise.resolve({ subjectScores: [], aggregateScore: 0, aggregateMaxMarks: 0 })
        );
      },
      resumeSession: (candidateUserId, clientSessionId) => {
        recorded.resumeCalls.push({ candidateUserId, clientSessionId });
        return service.resumeSession?.(candidateUserId, clientSessionId) ?? Promise.resolve(null);
      },
    },
  });

  const server = app.listen(0);
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('expected a bound TCP address');
  }

  return { url: `http://localhost:${address.port}`, close: () => server.close(), recorded };
}

const servers: { close: () => void }[] = [];
function run(service: Partial<CandidateSyncService>): ReturnType<typeof startApp> {
  const started = startApp(service);
  servers.push(started);
  return started;
}

afterAll(() => {
  for (const server of servers) {
    server.close();
  }
});

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

describe('POST /candidate/register', () => {
  it('registers and returns a bearer token, without auth', async () => {
    const { url, recorded } = run({ register: async () => ({ userId: 42 }) });

    const response = await fetch(`${url}/candidate/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(VALID_REGISTER),
    });
    const body = await readJson<{ token: string; userId: number }>(response);

    expect(response.status).toBe(201);
    expect(body.userId).toBe(42);
    expect(typeof body.token).toBe('string');
    expect(recorded.registerCalls).toEqual([VALID_REGISTER]);
  });

  it('the returned token authenticates a later request', async () => {
    const { url } = run({ register: async () => ({ userId: 7 }) });

    const registerResponse = await fetch(`${url}/candidate/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(VALID_REGISTER),
    });
    const { token } = await readJson<{ token: string }>(registerResponse);

    const sessionResponse = await fetch(`${url}/candidate/sessions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(VALID_START_SESSION),
    });
    expect(sessionResponse.status).toBe(201);
  });

  it('rejects a missing phone', async () => {
    const { url } = run({});
    const withoutPhone: Record<string, unknown> = { ...VALID_REGISTER };
    delete withoutPhone.phone;

    const response = await fetch(`${url}/candidate/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(withoutPhone),
    });
    expect(response.status).toBe(400);
  });

  it('rejects a non-positive examYear', async () => {
    const { url } = run({});
    const response = await fetch(`${url}/candidate/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_REGISTER, examYear: 0 }),
    });
    expect(response.status).toBe(400);
  });
});

describe('POST /candidate/sessions', () => {
  it('starts a session as the authenticated candidate, never a body-supplied id', async () => {
    const { url, recorded } = run({ startSession: async () => ({ sessionId: 99 }) });

    const response = await fetch(`${url}/candidate/sessions`, {
      method: 'POST',
      headers: { ...authHeader(5), 'content-type': 'application/json' },
      body: JSON.stringify(VALID_START_SESSION),
    });
    const body = await readJson<{ sessionId: number }>(response);

    expect(response.status).toBe(201);
    expect(body).toEqual({ sessionId: 99 });
    expect(recorded.startSessionCalls).toEqual([{ candidateUserId: 5, input: VALID_START_SESSION }]);
  });

  it('rejects an invalid mode', async () => {
    const { url } = run({});
    const response = await fetch(`${url}/candidate/sessions`, {
      method: 'POST',
      headers: { ...authHeader(5), 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_START_SESSION, mode: 'exam' }),
    });
    expect(response.status).toBe(400);
  });

  it('rejects a request with no session', async () => {
    const { url } = run({});
    const response = await fetch(`${url}/candidate/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(VALID_START_SESSION),
    });
    expect(response.status).toBe(401);
  });
});

describe('POST /candidate/sessions/:sessionId/attempts', () => {
  it('records an attempt as the authenticated candidate', async () => {
    const { url, recorded } = run({ recordAttempt: async () => ({ attemptId: 123 }) });

    const response = await fetch(`${url}/candidate/sessions/9/attempts`, {
      method: 'POST',
      headers: { ...authHeader(5), 'content-type': 'application/json' },
      body: JSON.stringify(VALID_ATTEMPT),
    });
    const body = await readJson<{ attemptId: number }>(response);

    expect(response.status).toBe(201);
    expect(body).toEqual({ attemptId: 123 });
    expect(recorded.recordAttemptCalls).toEqual([
      { candidateUserId: 5, sessionId: 9, input: VALID_ATTEMPT },
    ]);
  });

  it('rejects an invalid chosenOption', async () => {
    const { url } = run({});
    const response = await fetch(`${url}/candidate/sessions/9/attempts`, {
      method: 'POST',
      headers: { ...authHeader(5), 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_ATTEMPT, chosenOption: 'E' }),
    });
    expect(response.status).toBe(400);
  });

  it('rejects a missing idempotencyKey', async () => {
    const { url } = run({});
    const withoutKey: Record<string, unknown> = { ...VALID_ATTEMPT };
    delete withoutKey.idempotencyKey;

    const response = await fetch(`${url}/candidate/sessions/9/attempts`, {
      method: 'POST',
      headers: { ...authHeader(5), 'content-type': 'application/json' },
      body: JSON.stringify(withoutKey),
    });
    expect(response.status).toBe(400);
  });

  it('rejects a non-numeric session id', async () => {
    const { url } = run({});
    const response = await fetch(`${url}/candidate/sessions/not-a-number/attempts`, {
      method: 'POST',
      headers: { ...authHeader(5), 'content-type': 'application/json' },
      body: JSON.stringify(VALID_ATTEMPT),
    });
    expect(response.status).toBe(400);
  });
});

describe('POST /candidate/sessions/:sessionId/end', () => {
  it('ends and returns the authoritative score', async () => {
    const score = {
      subjectScores: [{ subjectId: 1, score: 80, maxMarks: 100 }],
      aggregateScore: 80,
      aggregateMaxMarks: 100,
    };
    const { url, recorded } = run({ endSession: async () => score });

    const response = await fetch(`${url}/candidate/sessions/9/end`, {
      method: 'POST',
      headers: { ...authHeader(5), 'content-type': 'application/json' },
      body: JSON.stringify({ endedAt: '2026-08-19T09:00:00.000Z' }),
    });
    const body = await readJson<typeof score>(response);

    expect(response.status).toBe(200);
    expect(body).toEqual(score);
    expect(recorded.endSessionCalls).toEqual([
      { candidateUserId: 5, sessionId: 9, input: { endedAt: '2026-08-19T09:00:00.000Z' } },
    ]);
  });

  it('rejects an invalid endedAt', async () => {
    const { url } = run({});
    const response = await fetch(`${url}/candidate/sessions/9/end`, {
      method: 'POST',
      headers: { ...authHeader(5), 'content-type': 'application/json' },
      body: JSON.stringify({ endedAt: 'not-a-date' }),
    });
    expect(response.status).toBe(400);
  });
});

describe('GET /candidate/sessions/:clientSessionId/resume', () => {
  it('returns the resumed session', async () => {
    const resumed: CandidateSessionResumeResult = {
      sessionId: 9,
      startedAt: '2026-08-19T08:00:00.000Z',
      endedAt: null,
      examConfigId: 7,
      attempts: [],
    };
    const { url, recorded } = run({ resumeSession: async () => resumed });

    const response = await fetch(`${url}/candidate/sessions/client-session-1/resume`, {
      headers: authHeader(5),
    });
    const body = await readJson<CandidateSessionResumeResult>(response);

    expect(response.status).toBe(200);
    expect(body).toEqual(resumed);
    expect(recorded.resumeCalls).toEqual([{ candidateUserId: 5, clientSessionId: 'client-session-1' }]);
  });

  it('reports 404 when nothing matches (including another candidate\'s session)', async () => {
    const { url } = run({ resumeSession: async () => null });

    const response = await fetch(`${url}/candidate/sessions/someone-elses-session/resume`, {
      headers: authHeader(5),
    });
    expect(response.status).toBe(404);
  });

  it('rejects a request with no session', async () => {
    const { url } = run({});
    expect((await fetch(`${url}/candidate/sessions/client-session-1/resume`)).status).toBe(401);
  });
});
