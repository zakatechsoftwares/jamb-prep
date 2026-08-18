import { afterAll, describe, expect, it } from 'vitest';
import type { BriefBoardService, BriefSummary } from '@jamb/shared';
import { signSessionToken } from '@jamb/db/session-tokens';
import { createApp } from '../app';

process.env.REVIEWER_SESSION_SECRET ??= 'test-secret-do-not-use-in-prod';

function authHeader(reviewerId: number, role: 'reviewer' | 'contributor' = 'contributor') {
  const token = signSessionToken(
    { reviewerId, role },
    process.env.REVIEWER_SESSION_SECRET!,
    new Date(),
    60,
  );
  return { Authorization: `Bearer ${token}` };
}

const DEADLINE = new Date('2026-09-01T00:00:00.000Z');

function brief(id: number, overrides: Partial<BriefSummary> = {}): BriefSummary {
  return {
    id,
    objectiveId: 1,
    itemCount: 2,
    difficultySpread: { easy: 1, moderate: 1 },
    cognitiveLevels: { recall: 2 },
    styleNotes: null,
    feeKobo: 500000,
    deadline: DEADLINE.toISOString(),
    status: 'open',
    claimedByUserId: null,
    ...overrides,
  };
}

const VALID_ITEM = {
  stem: 'What is the SI unit of force?',
  explanation: 'The newton is the SI unit of force.',
  methodSteps: ['Recall F = ma.'],
  cognitiveLevel: 'recall',
  authorDifficulty: 0.3,
  expectedTimeSeconds: 40,
  options: [
    { label: 'A', text: 'newton', isCorrect: true, distractorRationale: null },
    { label: 'B', text: 'joule', isCorrect: false, distractorRationale: 'confuses energy' },
    { label: 'C', text: 'watt', isCorrect: false, distractorRationale: 'confuses power' },
    { label: 'D', text: 'pascal', isCorrect: false, distractorRationale: 'confuses pressure' },
  ],
};

interface Recorded {
  listCalls: number;
  claimCalls: { briefId: number; contributorReviewerId: number }[];
  submitCalls: { briefId: number; contributorReviewerId: number; draft: unknown }[];
  submitWithDiagramCalls: {
    briefId: number;
    contributorReviewerId: number;
    draft: unknown;
    sketchPhoto: { bytes: Uint8Array; contentType: string };
  }[];
}

function startApp(service: Partial<BriefBoardService>): {
  url: string;
  close: () => void;
  recorded: Recorded;
} {
  const recorded: Recorded = {
    listCalls: 0,
    claimCalls: [],
    submitCalls: [],
    submitWithDiagramCalls: [],
  };

  const app = createApp({
    briefBoard: {
      listOpenBriefs: () => {
        recorded.listCalls += 1;
        return service.listOpenBriefs?.() ?? Promise.resolve([]);
      },
      claimBrief: (briefId, contributorReviewerId) => {
        recorded.claimCalls.push({ briefId, contributorReviewerId });
        return service.claimBrief?.(briefId, contributorReviewerId) ?? Promise.resolve(brief(briefId));
      },
      submitContributedItem: (briefId, contributorReviewerId, draft) => {
        recorded.submitCalls.push({ briefId, contributorReviewerId, draft });
        return (
          service.submitContributedItem?.(briefId, contributorReviewerId, draft) ??
          Promise.resolve({ itemId: 1 })
        );
      },
      submitContributedItemWithDiagram: (briefId, contributorReviewerId, draft, sketchPhoto) => {
        recorded.submitWithDiagramCalls.push({ briefId, contributorReviewerId, draft, sketchPhoto });
        return (
          service.submitContributedItemWithDiagram?.(briefId, contributorReviewerId, draft, sketchPhoto) ??
          Promise.resolve({ itemId: 1 })
        );
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
function run(service: Partial<BriefBoardService>): ReturnType<typeof startApp> {
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

describe('GET /briefs', () => {
  it('lists open briefs for any active session, not just contributors', async () => {
    const { url, recorded } = run({ listOpenBriefs: async () => [brief(1), brief(2)] });

    const response = await fetch(`${url}/briefs`, { headers: authHeader(9, 'reviewer') });
    const body = await readJson<{ briefs: BriefSummary[] }>(response);

    expect(response.status).toBe(200);
    expect(body.briefs.map((b) => b.id)).toEqual([1, 2]);
    expect(recorded.listCalls).toBe(1);
  });

  it('rejects a request with no session', async () => {
    const { url } = run({});
    expect((await fetch(`${url}/briefs`)).status).toBe(401);
  });
});

describe('POST /briefs/:id/claim', () => {
  it('claims the brief as the authenticated reviewer, never a body-supplied id', async () => {
    const { url, recorded } = run({ claimBrief: async (id) => brief(id, { status: 'claimed' }) });

    const response = await fetch(`${url}/briefs/7/claim`, {
      method: 'POST',
      headers: authHeader(3),
    });
    const body = await readJson<BriefSummary>(response);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ id: 7, status: 'claimed' });
    expect(recorded.claimCalls).toEqual([{ briefId: 7, contributorReviewerId: 3 }]);
  });

  it('rejects a non-numeric brief id', async () => {
    const { url } = run({});
    expect(
      (await fetch(`${url}/briefs/not-a-number/claim`, { method: 'POST', headers: authHeader(3) }))
        .status,
    ).toBe(400);
  });

  it('rejects a request with no session', async () => {
    const { url } = run({});
    expect((await fetch(`${url}/briefs/7/claim`, { method: 'POST' })).status).toBe(401);
  });

  it('propagates a not-claimable brief as an error response rather than a fabricated success', async () => {
    const { url } = run({
      claimBrief: async () => {
        throw new Error('brief 7 is not claimable (status: claimed)');
      },
    });

    const response = await fetch(`${url}/briefs/7/claim`, { method: 'POST', headers: authHeader(3) });
    expect(response.status).toBe(500);
  });
});

describe('POST /briefs/:id/submit', () => {
  it('submits a well-formed item and returns its id', async () => {
    const { url, recorded } = run({ submitContributedItem: async () => ({ itemId: 42 }) });

    const response = await fetch(`${url}/briefs/7/submit`, {
      method: 'POST',
      headers: { ...authHeader(3), 'content-type': 'application/json' },
      body: JSON.stringify(VALID_ITEM),
    });
    const body = await readJson<{ itemId: number }>(response);

    expect(response.status).toBe(201);
    expect(body).toEqual({ itemId: 42 });
    expect(recorded.submitCalls[0]).toMatchObject({ briefId: 7, contributorReviewerId: 3 });
  });

  it('rejects a missing stem', async () => {
    const { url } = run({});
    const withoutStem: Record<string, unknown> = { ...VALID_ITEM };
    delete withoutStem.stem;

    const response = await fetch(`${url}/briefs/7/submit`, {
      method: 'POST',
      headers: { ...authHeader(3), 'content-type': 'application/json' },
      body: JSON.stringify(withoutStem),
    });
    expect(response.status).toBe(400);
  });

  it('rejects fewer than 4 options', async () => {
    const { url } = run({});
    const malformed = { ...VALID_ITEM, options: VALID_ITEM.options.slice(0, 3) };

    const response = await fetch(`${url}/briefs/7/submit`, {
      method: 'POST',
      headers: { ...authHeader(3), 'content-type': 'application/json' },
      body: JSON.stringify(malformed),
    });
    expect(response.status).toBe(400);
  });

  it('rejects zero or more than one correct option', async () => {
    const { url } = run({});
    const noneCorrect = {
      ...VALID_ITEM,
      options: VALID_ITEM.options.map((option) => ({ ...option, isCorrect: false })),
    };

    const response = await fetch(`${url}/briefs/7/submit`, {
      method: 'POST',
      headers: { ...authHeader(3), 'content-type': 'application/json' },
      body: JSON.stringify(noneCorrect),
    });
    expect(response.status).toBe(400);
  });

  it('rejects a missing distractor rationale on a wrong option', async () => {
    const { url } = run({});
    const missingRationale = {
      ...VALID_ITEM,
      options: VALID_ITEM.options.map((option) =>
        option.label === 'B' ? { ...option, distractorRationale: null } : option,
      ),
    };

    const response = await fetch(`${url}/briefs/7/submit`, {
      method: 'POST',
      headers: { ...authHeader(3), 'content-type': 'application/json' },
      body: JSON.stringify(missingRationale),
    });
    expect(response.status).toBe(400);
  });

  it('rejects a request with no session', async () => {
    const { url } = run({});
    const response = await fetch(`${url}/briefs/7/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(VALID_ITEM),
    });
    expect(response.status).toBe(401);
  });

  it('rejects an item with a diagramRequest, directing it to /submit-with-diagram instead', async () => {
    const { url } = run({});
    const response = await fetch(`${url}/briefs/7/submit`, {
      method: 'POST',
      headers: { ...authHeader(3), 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_ITEM, diagramRequest: { figureDescription: 'a diagram' } }),
    });
    expect(response.status).toBe(400);
  });
});

describe('POST /briefs/:id/submit-with-diagram', () => {
  function multipartBody(itemOverrides: Record<string, unknown> = {}) {
    const form = new FormData();
    form.set(
      'itemJson',
      JSON.stringify({
        ...VALID_ITEM,
        diagramRequest: { figureDescription: 'a free-body diagram' },
        ...itemOverrides,
      }),
    );
    form.set('sketchPhoto', new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }), 'sketch.jpg');
    return form;
  }

  it('submits a well-formed item with a sketch photo and returns its id', async () => {
    const { url, recorded } = run({ submitContributedItemWithDiagram: async () => ({ itemId: 42 }) });

    const response = await fetch(`${url}/briefs/7/submit-with-diagram`, {
      method: 'POST',
      headers: authHeader(3),
      body: multipartBody(),
    });
    const body = await readJson<{ itemId: number }>(response);

    expect(response.status).toBe(201);
    expect(body).toEqual({ itemId: 42 });
    expect(recorded.submitWithDiagramCalls).toHaveLength(1);
    expect(recorded.submitWithDiagramCalls[0]).toMatchObject({ briefId: 7, contributorReviewerId: 3 });
    expect(recorded.submitWithDiagramCalls[0]!.sketchPhoto.contentType).toBe('image/jpeg');
    expect(Array.from(recorded.submitWithDiagramCalls[0]!.sketchPhoto.bytes)).toEqual([1, 2, 3]);
  });

  it('rejects a request with no diagramRequest set', async () => {
    const { url } = run({});
    const form = new FormData();
    form.set('itemJson', JSON.stringify(VALID_ITEM));
    form.set('sketchPhoto', new Blob([new Uint8Array([1])], { type: 'image/jpeg' }), 'sketch.jpg');

    const response = await fetch(`${url}/briefs/7/submit-with-diagram`, {
      method: 'POST',
      headers: authHeader(3),
      body: form,
    });
    expect(response.status).toBe(400);
  });

  it('rejects a request with no sketch photo file', async () => {
    const { url } = run({});
    const form = new FormData();
    form.set(
      'itemJson',
      JSON.stringify({ ...VALID_ITEM, diagramRequest: { figureDescription: 'a diagram' } }),
    );

    const response = await fetch(`${url}/briefs/7/submit-with-diagram`, {
      method: 'POST',
      headers: authHeader(3),
      body: form,
    });
    expect(response.status).toBe(400);
  });

  it('rejects a request with no session', async () => {
    const { url } = run({});
    const response = await fetch(`${url}/briefs/7/submit-with-diagram`, {
      method: 'POST',
      body: multipartBody(),
    });
    expect(response.status).toBe(401);
  });
});
