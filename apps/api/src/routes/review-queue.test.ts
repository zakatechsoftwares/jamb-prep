import { afterAll, describe, expect, it } from 'vitest';
import type { ReviewQueueItem, ReviewQueueService } from '@jamb/shared';
import { createApp } from '../app';

const CLAIM_EXPIRY = new Date('2026-05-01T09:30:00.000Z');

function item(itemId: number): ReviewQueueItem {
  return {
    itemId,
    subjectId: 1,
    objectiveId: 7,
    stem: 'What is the SI unit of force?',
    options: [
      { label: 'A', text: 'newton' },
      { label: 'B', text: 'joule' },
      { label: 'C', text: 'watt' },
      { label: 'D', text: 'pascal' },
    ],
    cognitiveLevel: 'recall',
    independentSolveVerdict: 'agreed',
    claimExpiresAt: CLAIM_EXPIRY,
  };
}

interface Recorded {
  nextCalls: number[];
  batchCalls: { reviewerId: number; count: number }[];
}

function appWith(service: Partial<ReviewQueueService>): {
  url: string;
  close: () => void;
  recorded: Recorded;
} {
  const recorded: Recorded = { nextCalls: [], batchCalls: [] };

  const app = createApp({
    reviewQueue: {
      getNextItem: (reviewerId) => {
        recorded.nextCalls.push(reviewerId);
        return service.getNextItem?.(reviewerId) ?? Promise.resolve(null);
      },
      getNextItemBatch: (reviewerId, count) => {
        recorded.batchCalls.push({ reviewerId, count });
        return service.getNextItemBatch?.(reviewerId, count) ?? Promise.resolve([]);
      },
    },
  });

  const server = app.listen(0);
  const address = server.address();

  if (address === null || typeof address === 'string') {
    throw new Error('expected a bound TCP address');
  }

  return {
    url: `http://localhost:${address.port}`,
    close: () => server.close(),
    recorded,
  };
}

/** `Response.json()` is `unknown`; these tests assert on the shape. */
async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

const servers: { close: () => void }[] = [];

function startApp(service: Partial<ReviewQueueService>): ReturnType<typeof appWith> {
  const started = appWith(service);
  servers.push(started);
  return started;
}

afterAll(() => {
  for (const server of servers) {
    server.close();
  }
});

describe('GET /review/next', () => {
  it('serves the one item the queue assigns', async () => {
    const { url } = startApp({ getNextItem: async () => item(42) });

    const response = await fetch(`${url}/review/next?reviewerId=3`);
    const body = await readJson<{ itemId: number; stem: string; claimExpiresAt: string }>(response);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ itemId: 42, stem: 'What is the SI unit of force?' });
    expect(body.claimExpiresAt).toBe(CLAIM_EXPIRY.toISOString());
  });

  it('never reveals the key, so the reviewer answers blind', async () => {
    // Plan 7.10: the reviewer records their own answer before the proposed
    // key is revealed. The key is absent from the payload rather than
    // present and merely not rendered.
    const { url } = startApp({ getNextItem: async () => item(42) });

    const response = await fetch(`${url}/review/next?reviewerId=3`);
    const body = await readJson<{ options: Record<string, unknown>[] }>(response);

    expect(JSON.stringify(body)).not.toMatch(/is_correct|isCorrect|correctOption/i);
    for (const option of body.options) {
      expect(Object.keys(option).sort()).toEqual(['label', 'text']);
    }
  });

  it('says nothing rather than an error when the queue is drained', async () => {
    const { url } = startApp({ getNextItem: async () => null });

    const response = await fetch(`${url}/review/next?reviewerId=3`);

    expect(response.status).toBe(204);
  });

  it('rejects a missing or malformed reviewerId', async () => {
    const { url } = startApp({});

    expect((await fetch(`${url}/review/next`)).status).toBe(400);
    expect((await fetch(`${url}/review/next?reviewerId=nonsense`)).status).toBe(400);
    expect((await fetch(`${url}/review/next?reviewerId=-2`)).status).toBe(400);
    expect((await fetch(`${url}/review/next?reviewerId=1.5`)).status).toBe(400);
  });

  it('offers no way to browse, filter or choose', async () => {
    // 7.9: the reviewer never chooses what to work on, which is what
    // prevents cherry-picking of easy items. A list route would undo it.
    const { url, recorded } = startApp({ getNextItem: async () => item(1) });

    for (const path of ['/review', '/review/items', '/review/queue', '/review/list']) {
      expect((await fetch(`${url}${path}`)).status).toBe(404);
    }

    // A filter smuggled onto the assign endpoint is simply ignored: the
    // reviewer gets whatever the queue decides, not what they asked for.
    const filtered = await fetch(`${url}/review/next?reviewerId=1&riskTier=high&subjectId=9`);
    expect(filtered.status).toBe(200);

    // The one call that did reach the service carried nothing but the
    // reviewer's own id — no filter of any kind.
    expect(recorded.nextCalls).toEqual([1]);
  });
});

describe('GET /review/next-batch', () => {
  it('returns a batch for the offline cache', async () => {
    const { url, recorded } = startApp({
      getNextItemBatch: async () => [item(1), item(2), item(3)],
    });

    const response = await fetch(`${url}/review/next-batch?reviewerId=3&count=3`);
    const body = await readJson<{ items: { itemId: number }[] }>(response);

    expect(response.status).toBe(200);
    expect(body.items.map((entry) => entry.itemId)).toEqual([1, 2, 3]);
    expect(recorded.batchCalls).toEqual([{ reviewerId: 3, count: 3 }]);
  });

  it('returns an empty batch rather than an error when nothing is queued', async () => {
    const { url } = startApp({ getNextItemBatch: async () => [] });

    const response = await fetch(`${url}/review/next-batch?reviewerId=3&count=5`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [] });
  });

  it('rejects a missing or malformed count', async () => {
    const { url } = startApp({});

    expect((await fetch(`${url}/review/next-batch?reviewerId=3`)).status).toBe(400);
    expect((await fetch(`${url}/review/next-batch?reviewerId=3&count=0`)).status).toBe(400);
    expect((await fetch(`${url}/review/next-batch?reviewerId=3&count=many`)).status).toBe(400);
  });
});

describe('createApp without a queue service', () => {
  it('still serves health, so the app boots without a database', async () => {
    const app = createApp();
    const server = app.listen(0);
    const address = server.address();

    if (address === null || typeof address === 'string') {
      throw new Error('expected a bound TCP address');
    }

    try {
      const response = await fetch(`http://localhost:${address.port}/health`);
      expect(await response.json()).toEqual({ status: 'ok', service: 'api' });
    } finally {
      server.close();
    }
  });
});
