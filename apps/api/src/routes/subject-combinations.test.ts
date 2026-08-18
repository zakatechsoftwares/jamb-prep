import { afterAll, describe, expect, it } from 'vitest';
import type { SubjectCombinationOption, SubjectCombinationService } from '@jamb/shared';
import { signCandidateToken } from '@jamb/db/candidate-tokens';
import { createApp } from '../app';

process.env.CANDIDATE_SESSION_SECRET ??= 'test-secret-do-not-use-in-prod';

function authHeader(userId: number) {
  const token = signCandidateToken({ userId }, process.env.CANDIDATE_SESSION_SECRET!, new Date(), 60);
  return { Authorization: `Bearer ${token}` };
}

function combination(overrides: Partial<SubjectCombinationOption> = {}): SubjectCombinationOption {
  return {
    id: 1,
    courseName: 'Medicine and Surgery',
    subjects: [
      { subjectId: 1, subjectName: 'Use of English', role: 'compulsory' },
      { subjectId: 2, subjectName: 'Biology', role: 'elective' },
    ],
    ...overrides,
  };
}

interface Recorded {
  listCalls: number;
  selectCalls: { candidateUserId: number; input: unknown }[];
}

function startApp(service: Partial<SubjectCombinationService>): {
  url: string;
  close: () => void;
  recorded: Recorded;
} {
  const recorded: Recorded = { listCalls: 0, selectCalls: [] };

  const app = createApp({
    subjectCombination: {
      listSubjectCombinations: () => {
        recorded.listCalls += 1;
        return service.listSubjectCombinations?.() ?? Promise.resolve([]);
      },
      selectSubjectCombination: (candidateUserId, input) => {
        recorded.selectCalls.push({ candidateUserId, input });
        return service.selectSubjectCombination?.(candidateUserId, input) ?? Promise.resolve();
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
function run(service: Partial<SubjectCombinationService>): ReturnType<typeof startApp> {
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

describe('GET /candidate/subject-combinations', () => {
  it('lists combinations for an authenticated candidate', async () => {
    const { url, recorded } = run({ listSubjectCombinations: async () => [combination()] });

    const response = await fetch(`${url}/candidate/subject-combinations`, { headers: authHeader(5) });
    const body = await readJson<{ combinations: SubjectCombinationOption[] }>(response);

    expect(response.status).toBe(200);
    expect(body.combinations).toEqual([combination()]);
    expect(recorded.listCalls).toBe(1);
  });

  it('rejects a request with no session', async () => {
    const { url } = run({});
    expect((await fetch(`${url}/candidate/subject-combinations`)).status).toBe(401);
  });
});

describe('POST /candidate/subject-combination', () => {
  it('selects a combination as the authenticated candidate, never a body-supplied id', async () => {
    const { url, recorded } = run({});

    const response = await fetch(`${url}/candidate/subject-combination`, {
      method: 'POST',
      headers: { ...authHeader(5), 'content-type': 'application/json' },
      body: JSON.stringify({ subjectCombinationId: 3 }),
    });
    const body = await readJson<{ ok: true }>(response);

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(recorded.selectCalls).toEqual([{ candidateUserId: 5, input: { subjectCombinationId: 3 } }]);
  });

  it('rejects a missing subjectCombinationId', async () => {
    const { url } = run({});
    const response = await fetch(`${url}/candidate/subject-combination`, {
      method: 'POST',
      headers: { ...authHeader(5), 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(400);
  });

  it('rejects a non-positive subjectCombinationId', async () => {
    const { url } = run({});
    const response = await fetch(`${url}/candidate/subject-combination`, {
      method: 'POST',
      headers: { ...authHeader(5), 'content-type': 'application/json' },
      body: JSON.stringify({ subjectCombinationId: 0 }),
    });
    expect(response.status).toBe(400);
  });

  it('propagates an unknown combination id as an error response rather than a fabricated success', async () => {
    const { url } = run({
      selectSubjectCombination: async () => {
        throw new Error('subject combination 999 not found');
      },
    });

    const response = await fetch(`${url}/candidate/subject-combination`, {
      method: 'POST',
      headers: { ...authHeader(5), 'content-type': 'application/json' },
      body: JSON.stringify({ subjectCombinationId: 999 }),
    });
    expect(response.status).toBe(500);
  });

  it('rejects a request with no session', async () => {
    const { url } = run({});
    const response = await fetch(`${url}/candidate/subject-combination`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subjectCombinationId: 1 }),
    });
    expect(response.status).toBe(401);
  });
});
