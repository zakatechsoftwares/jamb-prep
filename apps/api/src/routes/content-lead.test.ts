import { afterAll, describe, expect, it } from 'vitest';
import type { ContentLeadService } from '@jamb/shared';
import { signSessionToken } from '@jamb/db/session-tokens';
import { createApp } from '../app';

process.env.REVIEWER_SESSION_SECRET ??= 'test-secret-do-not-use-in-prod';

function authHeader(
  reviewerId: number,
  role: 'reviewer' | 'moderator' | 'content_lead' = 'content_lead',
) {
  const token = signSessionToken(
    { reviewerId, role },
    process.env.REVIEWER_SESSION_SECRET!,
    new Date(),
    60,
  );
  return { Authorization: `Bearer ${token}` };
}

interface Recorded {
  getDashboardCalls: Date[];
  runWeeklyPaymentCalls: Date[];
  getAuditSampleCalls: { reviewerId: number; since: Date; count: number }[];
  recordModeratorAuditCalls: {
    itemId: number;
    moderatorId: number;
    agreed: boolean;
    note: string | null;
  }[];
  getGapsCalls: number;
  createBriefCalls: { input: unknown; createdByReviewerId: number }[];
}

function startApp(service: Partial<ContentLeadService>): {
  url: string;
  close: () => void;
  recorded: Recorded;
} {
  const recorded: Recorded = {
    getDashboardCalls: [],
    runWeeklyPaymentCalls: [],
    getAuditSampleCalls: [],
    recordModeratorAuditCalls: [],
    getGapsCalls: 0,
    createBriefCalls: [],
  };

  const app = createApp({
    contentLead: {
      getDashboard: (since) => {
        recorded.getDashboardCalls.push(since);
        return (
          service.getDashboard?.(since) ??
          Promise.resolve({
            acceptedItemsPerReviewerHour: 0,
            rejectionReasons: [],
            queueDepth: [],
            itemsByState: [],
            costPerApprovedItem: { approvedCount: 0, avgInferenceCostUsd: 0, avgReviewerFeesKobo: 0 },
            interRaterAgreement: [],
          })
        );
      },
      runWeeklyPayment: (runAt) => {
        recorded.runWeeklyPaymentCalls.push(runAt);
        return (
          service.runWeeklyPayment?.(runAt) ??
          Promise.resolve({ batchId: null, totalKobo: 0, lineCount: 0 })
        );
      },
      getAuditSample: (reviewerId, since, count) => {
        recorded.getAuditSampleCalls.push({ reviewerId, since, count });
        return service.getAuditSample?.(reviewerId, since, count) ?? Promise.resolve([]);
      },
      recordModeratorAudit: (itemId, moderatorId, agreed, note) => {
        recorded.recordModeratorAuditCalls.push({ itemId, moderatorId, agreed, note });
        return service.recordModeratorAudit?.(itemId, moderatorId, agreed, note) ?? Promise.resolve();
      },
      getGaps: () => {
        recorded.getGapsCalls += 1;
        return service.getGaps?.() ?? Promise.resolve([]);
      },
      createBrief: (input, createdByReviewerId) => {
        recorded.createBriefCalls.push({ input, createdByReviewerId });
        return service.createBrief?.(input, createdByReviewerId) ?? Promise.resolve({ briefId: 1 });
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

function run(service: Partial<ContentLeadService>): ReturnType<typeof startApp> {
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

describe('GET /content-lead/dashboard', () => {
  it('returns the dashboard for a content-lead session', async () => {
    const { url, recorded } = run({
      getDashboard: async () => ({
        acceptedItemsPerReviewerHour: 4.5,
        rejectionReasons: [],
        queueDepth: [],
        itemsByState: [],
        costPerApprovedItem: { approvedCount: 0, avgInferenceCostUsd: 0, avgReviewerFeesKobo: 0 },
        interRaterAgreement: [],
      }),
    });

    const response = await fetch(`${url}/content-lead/dashboard?since=2026-01-01T00:00:00.000Z`, {
      headers: authHeader(1),
    });
    const body = await readJson<{ acceptedItemsPerReviewerHour: number }>(response);

    expect(response.status).toBe(200);
    expect(body.acceptedItemsPerReviewerHour).toBe(4.5);
    expect(recorded.getDashboardCalls).toEqual([new Date('2026-01-01T00:00:00.000Z')]);
  });

  it('rejects a missing since query parameter', async () => {
    const { url } = run({});
    const response = await fetch(`${url}/content-lead/dashboard`, { headers: authHeader(1) });
    expect(response.status).toBe(400);
  });

  it('rejects a request with no session', async () => {
    const { url } = run({});
    const response = await fetch(`${url}/content-lead/dashboard?since=2026-01-01T00:00:00.000Z`);
    expect(response.status).toBe(401);
  });

  it('rejects a non-content-lead session with 403', async () => {
    const { url } = run({});
    const response = await fetch(`${url}/content-lead/dashboard?since=2026-01-01T00:00:00.000Z`, {
      headers: authHeader(1, 'moderator'),
    });
    expect(response.status).toBe(403);
  });
});

describe('POST /content-lead/payment-runs', () => {
  it('triggers a payment run for a content-lead session', async () => {
    const { url, recorded } = run({
      runWeeklyPayment: async () => ({ batchId: 7, totalKobo: 15000, lineCount: 2 }),
    });

    const response = await fetch(`${url}/content-lead/payment-runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(1) },
      body: JSON.stringify({ runAt: '2026-02-01T00:00:00.000Z' }),
    });
    const body = await readJson<{ batchId: number | null; totalKobo: number; lineCount: number }>(
      response,
    );

    expect(response.status).toBe(200);
    expect(body).toEqual({ batchId: 7, totalKobo: 15000, lineCount: 2 });
    expect(recorded.runWeeklyPaymentCalls).toEqual([new Date('2026-02-01T00:00:00.000Z')]);
  });

  it('defaults runAt to now when omitted', async () => {
    const { url, recorded } = run({});

    const response = await fetch(`${url}/content-lead/payment-runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(1) },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(200);
    expect(recorded.runWeeklyPaymentCalls).toHaveLength(1);
  });

  it('rejects a non-content-lead session with 403', async () => {
    const { url, recorded } = run({});
    const response = await fetch(`${url}/content-lead/payment-runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(1, 'reviewer') },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(403);
    expect(recorded.runWeeklyPaymentCalls).toEqual([]);
  });
});

describe('GET /content-lead/gaps', () => {
  it('returns the detected coverage gaps for a content-lead session', async () => {
    const { url, recorded } = run({
      getGaps: async () => [{ objectiveId: 5, deficit: 6, requiresHumanAuthorship: true }],
    });

    const response = await fetch(`${url}/content-lead/gaps`, { headers: authHeader(1) });
    const body = await readJson<{ gaps: unknown[] }>(response);

    expect(response.status).toBe(200);
    expect(body.gaps).toEqual([{ objectiveId: 5, deficit: 6, requiresHumanAuthorship: true }]);
    expect(recorded.getGapsCalls).toBe(1);
  });

  it('rejects a non-content-lead session with 403', async () => {
    const { url } = run({});
    const response = await fetch(`${url}/content-lead/gaps`, { headers: authHeader(1, 'reviewer') });
    expect(response.status).toBe(403);
  });
});

describe('POST /content-lead/briefs', () => {
  const VALID_BRIEF = {
    objectiveId: 5,
    itemCount: 3,
    difficultySpread: { easy: 1, moderate: 2 },
    cognitiveLevels: { recall: 3 },
    styleNotes: 'Keep it concise.',
    feeKobo: 500000,
    deadline: '2026-09-01T00:00:00.000Z',
  };

  it('creates a brief for a content-lead session, taking createdBy from the session not the body', async () => {
    const { url, recorded } = run({ createBrief: async () => ({ briefId: 9 }) });

    const response = await fetch(`${url}/content-lead/briefs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(4) },
      body: JSON.stringify({ ...VALID_BRIEF, createdByReviewerId: 999 }),
    });
    const body = await readJson<{ briefId: number }>(response);

    expect(response.status).toBe(201);
    expect(body).toEqual({ briefId: 9 });
    expect(recorded.createBriefCalls).toHaveLength(1);
    expect(recorded.createBriefCalls[0]!.createdByReviewerId).toBe(4);
  });

  it('rejects a missing objectiveId', async () => {
    const { url } = run({});
    const withoutObjectiveId: Record<string, unknown> = { ...VALID_BRIEF };
    delete withoutObjectiveId.objectiveId;

    const response = await fetch(`${url}/content-lead/briefs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(4) },
      body: JSON.stringify(withoutObjectiveId),
    });
    expect(response.status).toBe(400);
  });

  it('rejects an invalid deadline', async () => {
    const { url } = run({});

    const response = await fetch(`${url}/content-lead/briefs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(4) },
      body: JSON.stringify({ ...VALID_BRIEF, deadline: 'not-a-date' }),
    });
    expect(response.status).toBe(400);
  });

  it('rejects a non-content-lead session with 403', async () => {
    const { url, recorded } = run({});
    const response = await fetch(`${url}/content-lead/briefs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(4, 'reviewer') },
      body: JSON.stringify(VALID_BRIEF),
    });
    expect(response.status).toBe(403);
    expect(recorded.createBriefCalls).toEqual([]);
  });
});

describe('GET /content-lead/audit-sample', () => {
  it('returns a sample for a moderator session', async () => {
    const { url, recorded } = run({
      getAuditSample: async () => [{ itemId: 9, reviewerId: 3, decidedAt: new Date('2026-01-05') }],
    });

    const response = await fetch(
      `${url}/content-lead/audit-sample?reviewerId=3&since=2026-01-01T00:00:00.000Z&count=5`,
      { headers: authHeader(1, 'moderator') },
    );
    const body = await readJson<{ itemId: number }[]>(response);

    expect(response.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(recorded.getAuditSampleCalls).toEqual([
      { reviewerId: 3, since: new Date('2026-01-01T00:00:00.000Z'), count: 5 },
    ]);
  });

  it('rejects a non-moderator session with 403', async () => {
    const { url } = run({});
    const response = await fetch(
      `${url}/content-lead/audit-sample?reviewerId=3&since=2026-01-01T00:00:00.000Z&count=5`,
      { headers: authHeader(1, 'content_lead') },
    );
    expect(response.status).toBe(403);
  });

  it('rejects a missing count', async () => {
    const { url } = run({});
    const response = await fetch(
      `${url}/content-lead/audit-sample?reviewerId=3&since=2026-01-01T00:00:00.000Z`,
      { headers: authHeader(1, 'moderator') },
    );
    expect(response.status).toBe(400);
  });
});

describe('POST /content-lead/audits/:itemId', () => {
  it('records the moderator session id as moderatorId, never a client-supplied one', async () => {
    const { url, recorded } = run({});

    const response = await fetch(`${url}/content-lead/audits/9`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(42, 'moderator') },
      body: JSON.stringify({ agreed: false, note: 'wrong distractor', moderatorId: 999 }),
    });

    expect(response.status).toBe(204);
    expect(recorded.recordModeratorAuditCalls).toEqual([
      { itemId: 9, moderatorId: 42, agreed: false, note: 'wrong distractor' },
    ]);
  });

  it('defaults note to null when omitted', async () => {
    const { url, recorded } = run({});

    const response = await fetch(`${url}/content-lead/audits/9`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(42, 'moderator') },
      body: JSON.stringify({ agreed: true }),
    });

    expect(response.status).toBe(204);
    expect(recorded.recordModeratorAuditCalls).toEqual([
      { itemId: 9, moderatorId: 42, agreed: true, note: null },
    ]);
  });

  it('rejects a non-boolean agreed', async () => {
    const { url } = run({});
    const response = await fetch(`${url}/content-lead/audits/9`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(42, 'moderator') },
      body: JSON.stringify({ agreed: 'yes' }),
    });
    expect(response.status).toBe(400);
  });

  it('rejects a non-moderator session with 403', async () => {
    const { url, recorded } = run({});
    const response = await fetch(`${url}/content-lead/audits/9`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(42, 'content_lead') },
      body: JSON.stringify({ agreed: true }),
    });
    expect(response.status).toBe(403);
    expect(recorded.recordModeratorAuditCalls).toEqual([]);
  });
});
