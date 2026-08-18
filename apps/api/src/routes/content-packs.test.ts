import { afterAll, describe, expect, it } from 'vitest';
import type { ContentPackService, SubjectPack, SubjectPackManifestEntry } from '@jamb/shared';
import { signCandidateToken } from '@jamb/db/candidate-tokens';
import { createApp } from '../app';

process.env.CANDIDATE_SESSION_SECRET ??= 'test-secret-do-not-use-in-prod';

function authHeader(userId: number) {
  const token = signCandidateToken({ userId }, process.env.CANDIDATE_SESSION_SECRET!, new Date(), 60);
  return { Authorization: `Bearer ${token}` };
}

function manifestEntry(overrides: Partial<SubjectPackManifestEntry> = {}): SubjectPackManifestEntry {
  return { subjectId: 1, subjectName: 'Use of English', version: '1:1,2:1', itemCount: 2, ...overrides };
}

function pack(overrides: Partial<SubjectPack> = {}): SubjectPack {
  return {
    subjectId: 1,
    subjectName: 'Use of English',
    version: '1:1',
    items: [],
    ...overrides,
  };
}

interface Recorded {
  listCalls: number;
  downloadCalls: number[];
}

function startApp(service: Partial<ContentPackService>): {
  url: string;
  close: () => void;
  recorded: Recorded;
} {
  const recorded: Recorded = { listCalls: 0, downloadCalls: [] };

  const app = createApp({
    contentPack: {
      listAvailablePacks: () => {
        recorded.listCalls += 1;
        return service.listAvailablePacks?.() ?? Promise.resolve({ activeExamConfigId: null, packs: [] });
      },
      downloadPack: (subjectId) => {
        recorded.downloadCalls.push(subjectId);
        return service.downloadPack?.(subjectId) ?? Promise.resolve(null);
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
function run(service: Partial<ContentPackService>): ReturnType<typeof startApp> {
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

describe('GET /candidate/content-packs', () => {
  it('lists the manifest for an authenticated candidate', async () => {
    const { url, recorded } = run({
      listAvailablePacks: async () => ({ activeExamConfigId: 7, packs: [manifestEntry()] }),
    });

    const response = await fetch(`${url}/candidate/content-packs`, { headers: authHeader(5) });
    const body = await readJson<{ activeExamConfigId: number | null; packs: SubjectPackManifestEntry[] }>(
      response,
    );

    expect(response.status).toBe(200);
    expect(body).toEqual({ activeExamConfigId: 7, packs: [manifestEntry()] });
    expect(recorded.listCalls).toBe(1);
  });

  it('rejects a request with no session', async () => {
    const { url } = run({});
    expect((await fetch(`${url}/candidate/content-packs`)).status).toBe(401);
  });
});

describe('GET /candidate/content-packs/:subjectId', () => {
  it('returns the pack for an authenticated candidate', async () => {
    const { url, recorded } = run({ downloadPack: async () => pack() });

    const response = await fetch(`${url}/candidate/content-packs/1`, { headers: authHeader(5) });
    const body = await readJson<SubjectPack>(response);

    expect(response.status).toBe(200);
    expect(body).toEqual(pack());
    expect(recorded.downloadCalls).toEqual([1]);
  });

  it('reports 404 when the subject has no approved content', async () => {
    const { url } = run({ downloadPack: async () => null });

    const response = await fetch(`${url}/candidate/content-packs/1`, { headers: authHeader(5) });
    expect(response.status).toBe(404);
  });

  it('rejects a non-numeric subject id', async () => {
    const { url } = run({});
    const response = await fetch(`${url}/candidate/content-packs/not-a-number`, {
      headers: authHeader(5),
    });
    expect(response.status).toBe(400);
  });

  it('rejects a request with no session', async () => {
    const { url } = run({});
    expect((await fetch(`${url}/candidate/content-packs/1`)).status).toBe(401);
  });
});
