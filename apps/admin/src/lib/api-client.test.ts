import { describe, expect, it } from 'vitest';
import { createApiClient, type FetchImpl } from './api-client';

interface Recorded {
  url: string;
  method: string | undefined;
  headers: Record<string, string>;
  body: unknown;
}

function fakeFetch(responses: { status: number; body?: unknown }[]): {
  fetchImpl: FetchImpl;
  calls: Recorded[];
} {
  const calls: Recorded[] = [];
  let index = 0;

  const fetchImpl: FetchImpl = async (input, init) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });

    calls.push({
      url: String(input),
      method: init?.method,
      headers,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    });

    const response = responses[Math.min(index, responses.length - 1)]!;
    index += 1;

    return new Response(
      response.status === 204 || response.body === undefined ? null : JSON.stringify(response.body),
      { status: response.status },
    );
  };

  return { fetchImpl, calls };
}

describe('login', () => {
  it('posts emailOrPhone and password, returning the token on success', async () => {
    const { fetchImpl, calls } = fakeFetch([
      { status: 200, body: { token: 'tok123', reviewerId: 7, role: 'reviewer' } },
    ]);
    const client = createApiClient(fetchImpl);

    const result = await client.login('reviewer@example.test', 'hunter2');

    expect(result).toEqual({
      ok: true,
      token: 'tok123',
      reviewerId: 7,
      role: 'reviewer',
      mustChangePassword: false,
    });
    expect(calls).toEqual([
      {
        url: '/api/review/login',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: { emailOrPhone: 'reviewer@example.test', password: 'hunter2' },
      },
    ]);
  });

  it('reports invalid_credentials on 401, distinct from the unauthorized reason the other routes use', async () => {
    const { fetchImpl } = fakeFetch([{ status: 401, body: { error: 'invalid_credentials' } }]);
    const client = createApiClient(fetchImpl);

    const result = await client.login('reviewer@example.test', 'wrong');

    expect(result).toEqual({ ok: false, reason: 'invalid_credentials' });
  });

  it('reports request_failed when the network call itself throws', async () => {
    const fetchImpl: FetchImpl = async () => {
      throw new Error('offline');
    };
    const client = createApiClient(fetchImpl);

    const result = await client.login('reviewer@example.test', 'hunter2');

    expect(result).toMatchObject({ ok: false, reason: 'request_failed' });
  });
});

describe('getNextItem', () => {
  const ITEM_BODY = {
    itemId: 42,
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
    claimExpiresAt: '2026-08-09T10:00:00.000Z',
    diagram: null,
  };

  it('sends the bearer token and parses claimExpiresAt into a real Date', async () => {
    const { fetchImpl, calls } = fakeFetch([{ status: 200, body: ITEM_BODY }]);
    const client = createApiClient(fetchImpl);

    const result = await client.getNextItem('tok123');

    expect(calls[0]).toMatchObject({
      url: '/api/review/next',
      method: 'GET',
      headers: { authorization: 'Bearer tok123' },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.item?.claimExpiresAt).toBeInstanceOf(Date);
      expect(result.item?.claimExpiresAt.toISOString()).toBe('2026-08-09T10:00:00.000Z');
      expect(result.item?.itemId).toBe(42);
    }
  });

  it('reports a null item on 204, not an error', async () => {
    const { fetchImpl } = fakeFetch([{ status: 204 }]);
    const client = createApiClient(fetchImpl);

    const result = await client.getNextItem('tok123');

    expect(result).toEqual({ ok: true, item: null });
  });

  it('reports unauthorized on 401', async () => {
    const { fetchImpl } = fakeFetch([{ status: 401, body: { error: 'authentication required' } }]);
    const client = createApiClient(fetchImpl);

    expect(await client.getNextItem('bad-token')).toEqual({ ok: false, reason: 'unauthorized' });
  });
});

describe('getNextItemBatch', () => {
  const ITEM_BODY = {
    itemId: 42,
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
    claimExpiresAt: '2026-08-09T10:00:00.000Z',
    diagram: null,
  };

  it('requests the given count and parses claimExpiresAt for every item', async () => {
    const { fetchImpl, calls } = fakeFetch([
      { status: 200, body: { items: [ITEM_BODY, { ...ITEM_BODY, itemId: 43 }] } },
    ]);
    const client = createApiClient(fetchImpl);

    const result = await client.getNextItemBatch('tok123', 2);

    expect(calls[0]).toMatchObject({
      url: '/api/review/next-batch?count=2',
      method: 'GET',
      headers: { authorization: 'Bearer tok123' },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.items).toHaveLength(2);
      expect(result.items[0]?.claimExpiresAt).toBeInstanceOf(Date);
      expect(result.items.map((item) => item.itemId)).toEqual([42, 43]);
    }
  });

  it('reports an empty batch as an empty array, not an error', async () => {
    const { fetchImpl } = fakeFetch([{ status: 200, body: { items: [] } }]);
    const client = createApiClient(fetchImpl);

    expect(await client.getNextItemBatch('tok123', 5)).toEqual({ ok: true, items: [] });
  });

  it('reports unauthorized on 401', async () => {
    const { fetchImpl } = fakeFetch([{ status: 401, body: {} }]);
    const client = createApiClient(fetchImpl);

    expect(await client.getNextItemBatch('bad-token', 5)).toEqual({
      ok: false,
      reason: 'unauthorized',
    });
  });

  it('reports request_failed when the network call itself throws', async () => {
    const fetchImpl: FetchImpl = async () => {
      throw new Error('offline');
    };
    const client = createApiClient(fetchImpl);

    expect(await client.getNextItemBatch('tok123', 5)).toMatchObject({
      ok: false,
      reason: 'request_failed',
    });
  });
});

describe('submitSolve', () => {
  it('posts the answer with the bearer token', async () => {
    const { fetchImpl, calls } = fakeFetch([{ status: 200, body: { itemId: 9, answer: 'B' } }]);
    const client = createApiClient(fetchImpl);

    const result = await client.submitSolve('tok123', 9, 'B');

    expect(calls[0]).toMatchObject({
      url: '/api/review/9/solve',
      method: 'POST',
      headers: { authorization: 'Bearer tok123', 'content-type': 'application/json' },
      body: { answer: 'B' },
    });
    expect(result).toEqual({ ok: true, itemId: 9, answer: 'B' });
  });

  it('reports already_answered on 409', async () => {
    const { fetchImpl } = fakeFetch([{ status: 409, body: { error: 'already_answered' } }]);
    const client = createApiClient(fetchImpl);

    expect(await client.submitSolve('tok123', 9, 'A')).toEqual({
      ok: false,
      reason: 'already_answered',
    });
  });

  it('reports unauthorized on 401', async () => {
    const { fetchImpl } = fakeFetch([{ status: 401, body: {} }]);
    const client = createApiClient(fetchImpl);

    expect(await client.submitSolve('tok123', 9, 'A')).toEqual({
      ok: false,
      reason: 'unauthorized',
    });
  });
});

describe('reveal', () => {
  it('gets with the bearer token and returns the reveal result on success', async () => {
    const { fetchImpl, calls } = fakeFetch([
      {
        status: 200,
        body: {
          correctOption: 'C',
          explanation: 'Because...',
          verdict: 'agreed',
          agreesWithKey: true,
        },
      },
    ]);
    const client = createApiClient(fetchImpl);

    const result = await client.reveal('tok123', 9);

    expect(calls[0]).toMatchObject({ url: '/api/review/9/reveal', method: 'GET' });
    expect(result).toEqual({
      ok: true,
      result: {
        correctOption: 'C',
        explanation: 'Because...',
        verdict: 'agreed',
        agreesWithKey: true,
      },
    });
  });

  it('reports not_yet_solved on 403 with that reason', async () => {
    const { fetchImpl } = fakeFetch([{ status: 403, body: { error: 'not_yet_solved' } }]);
    const client = createApiClient(fetchImpl);

    expect(await client.reveal('tok123', 9)).toEqual({ ok: false, reason: 'not_yet_solved' });
  });

  it('reports unauthorized on 401', async () => {
    const { fetchImpl } = fakeFetch([{ status: 401, body: {} }]);
    const client = createApiClient(fetchImpl);

    expect(await client.reveal('tok123', 9)).toEqual({ ok: false, reason: 'unauthorized' });
  });
});

describe('decide', () => {
  it('posts the decision input with the bearer token', async () => {
    const { fetchImpl, calls } = fakeFetch([
      {
        status: 200,
        body: {
          itemId: 9,
          status: 'approved_uncalibrated',
          approvalRoute: 'human_reviewed',
          decisionContext: 'live',
        },
      },
    ]);
    const client = createApiClient(fetchImpl);

    const result = await client.decide('tok123', 9, { action: 'approve' });

    expect(calls[0]).toMatchObject({
      url: '/api/review/9/decide',
      method: 'POST',
      headers: { authorization: 'Bearer tok123' },
      body: { action: 'approve' },
    });
    expect(result).toEqual({
      ok: true,
      itemId: 9,
      status: 'approved_uncalibrated',
      approvalRoute: 'human_reviewed',
      decisionContext: 'live',
    });
  });

  it('reports decisionContext late_arrival distinctly, for a decision synced after its claim expired', async () => {
    const { fetchImpl } = fakeFetch([
      {
        status: 200,
        body: {
          itemId: 9,
          status: 'approved_uncalibrated',
          approvalRoute: 'human_reviewed',
          decisionContext: 'late_arrival',
        },
      },
    ]);
    const client = createApiClient(fetchImpl);

    const result = await client.decide('tok123', 9, { action: 'reject', rejectionReason: 'wrong_key' });

    expect(result).toMatchObject({ ok: true, decisionContext: 'late_arrival' });
  });

  it('includes a supplied idempotency key in the request body', async () => {
    const { fetchImpl, calls } = fakeFetch([
      {
        status: 200,
        body: {
          itemId: 9,
          status: 'approved_uncalibrated',
          approvalRoute: 'human_reviewed',
          decisionContext: 'live',
        },
      },
    ]);
    const client = createApiClient(fetchImpl);

    await client.decide('tok123', 9, { action: 'approve' }, 'queued-decision-1');

    expect(calls[0]?.body).toEqual({ action: 'approve', idempotencyKey: 'queued-decision-1' });
  });

  it('omits idempotencyKey from the body when none is supplied', async () => {
    const { fetchImpl, calls } = fakeFetch([
      {
        status: 200,
        body: {
          itemId: 9,
          status: 'approved_uncalibrated',
          approvalRoute: 'human_reviewed',
          decisionContext: 'live',
        },
      },
    ]);
    const client = createApiClient(fetchImpl);

    await client.decide('tok123', 9, { action: 'approve' });

    expect(calls[0]?.body).toEqual({ action: 'approve' });
  });

  it('sends a structured rejection reason for reject', async () => {
    const { fetchImpl, calls } = fakeFetch([
      { status: 200, body: { itemId: 9, status: 'rejected', approvalRoute: null } },
    ]);
    const client = createApiClient(fetchImpl);

    await client.decide('tok123', 9, { action: 'reject', rejectionReason: 'wrong_key' });

    expect(calls[0]?.body).toEqual({ action: 'reject', rejectionReason: 'wrong_key' });
  });

  it('sends the edit patch for edit_and_approve', async () => {
    const { fetchImpl, calls } = fakeFetch([
      {
        status: 200,
        body: { itemId: 9, status: 'approved_uncalibrated', approvalRoute: 'human_reviewed' },
      },
    ]);
    const client = createApiClient(fetchImpl);

    await client.decide('tok123', 9, {
      action: 'edit_and_approve',
      edits: { stem: 'Corrected stem' },
    });

    expect(calls[0]?.body).toEqual({
      action: 'edit_and_approve',
      edits: { stem: 'Corrected stem' },
    });
  });

  it('reports invalid_transition with the server message on 409', async () => {
    const { fetchImpl } = fakeFetch([
      { status: 409, body: { error: 'invalid_transition', message: 'already decided' } },
    ]);
    const client = createApiClient(fetchImpl);

    expect(await client.decide('tok123', 9, { action: 'approve' })).toEqual({
      ok: false,
      reason: 'invalid_transition',
      message: 'already decided',
    });
  });

  it('reports unauthorized on 401', async () => {
    const { fetchImpl } = fakeFetch([{ status: 401, body: {} }]);
    const client = createApiClient(fetchImpl);

    expect(await client.decide('tok123', 9, { action: 'approve' })).toEqual({
      ok: false,
      reason: 'unauthorized',
    });
  });
});

describe('getContentDashboard', () => {
  it('requests the dashboard with since as an ISO query parameter', async () => {
    const { fetchImpl, calls } = fakeFetch([
      {
        status: 200,
        body: {
          acceptedItemsPerReviewerHour: 3.5,
          rejectionReasons: [
            { subjectId: 1, week: '2026-01-05T00:00:00.000Z', rejectionReason: 'wrong_key', count: 4 },
          ],
          queueDepth: [{ subjectId: 1, depth: 12 }],
          itemsByState: [{ status: 'pending_review', count: 12 }],
          costPerApprovedItem: { approvedCount: 10, avgInferenceCostUsd: 0.02, avgReviewerFeesKobo: 5000 },
          interRaterAgreement: [{ subjectId: 1, pairCount: 4, agreementRate: 0.75 }],
          subjectCombinationReadiness: [],
        },
      },
    ]);
    const client = createApiClient(fetchImpl);

    const result = await client.getContentDashboard('tok123', new Date('2026-01-01T00:00:00.000Z'));

    expect(calls[0]?.url).toBe(
      '/api/content-lead/dashboard?since=2026-01-01T00%3A00%3A00.000Z',
    );
    expect(result).toEqual({
      ok: true,
      dashboard: {
        acceptedItemsPerReviewerHour: 3.5,
        rejectionReasons: [
          { subjectId: 1, week: new Date('2026-01-05T00:00:00.000Z'), rejectionReason: 'wrong_key', count: 4 },
        ],
        queueDepth: [{ subjectId: 1, depth: 12 }],
        itemsByState: [{ status: 'pending_review', count: 12 }],
        costPerApprovedItem: { approvedCount: 10, avgInferenceCostUsd: 0.02, avgReviewerFeesKobo: 5000 },
        interRaterAgreement: [{ subjectId: 1, pairCount: 4, agreementRate: 0.75 }],
        subjectCombinationReadiness: [],
      },
    });
  });

  it('reports unauthorized on 401', async () => {
    const { fetchImpl } = fakeFetch([{ status: 401, body: {} }]);
    const client = createApiClient(fetchImpl);

    expect(await client.getContentDashboard('tok123', new Date())).toEqual({
      ok: false,
      reason: 'unauthorized',
    });
  });

  it('reports forbidden on 403, distinct from unauthorized', async () => {
    const { fetchImpl } = fakeFetch([{ status: 403, body: {} }]);
    const client = createApiClient(fetchImpl);

    expect(await client.getContentDashboard('tok123', new Date())).toEqual({
      ok: false,
      reason: 'forbidden',
    });
  });
});

describe('login mustChangePassword', () => {
  it('passes the server flag through when a temporary password is still held', async () => {
    const { fetchImpl } = fakeFetch([
      {
        status: 200,
        body: { token: 'tok123', reviewerId: 7, role: 'reviewer', mustChangePassword: true },
      },
    ]);
    const result = await createApiClient(fetchImpl).login('reviewer@example.test', 'TempPass2345');
    expect(result).toMatchObject({ ok: true, mustChangePassword: true });
  });
});

describe('changePassword', () => {
  it('posts both passwords with the bearer token and reports ok on 204', async () => {
    const { fetchImpl, calls } = fakeFetch([{ status: 204 }]);
    const result = await createApiClient(fetchImpl).changePassword(
      'tok',
      'TempPass2345',
      'my-secret',
    );

    expect(result).toEqual({ ok: true });
    expect(calls).toEqual([
      {
        url: '/api/review/change-password',
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer tok' },
        body: { currentPassword: 'TempPass2345', newPassword: 'my-secret' },
      },
    ]);
  });

  it('distinguishes a wrong current password from other 400s', async () => {
    const wrong = fakeFetch([{ status: 400, body: { error: 'wrong_current_password' } }]);
    expect(await createApiClient(wrong.fetchImpl).changePassword('tok', 'x', 'my-secret')).toEqual({
      ok: false,
      reason: 'wrong_current_password',
    });

    const invalid = fakeFetch([
      { status: 400, body: { error: 'newPassword must be at least 8 characters' } },
    ]);
    expect(await createApiClient(invalid.fetchImpl).changePassword('tok', 'x', 'y')).toEqual({
      ok: false,
      reason: 'invalid_input',
      message: 'newPassword must be at least 8 characters',
    });
  });

  it('reports unauthorized on 401', async () => {
    const { fetchImpl } = fakeFetch([{ status: 401, body: { error: 'authentication required' } }]);
    expect(await createApiClient(fetchImpl).changePassword('tok', 'x', 'my-secret')).toEqual({
      ok: false,
      reason: 'unauthorized',
    });
  });
});

describe('reviewer account management', () => {
  const account = {
    reviewerId: 4,
    fullName: 'Adaeze Okafor',
    phone: '+2348031234567',
    email: 'adaeze@example.test',
    role: 'reviewer',
    status: 'active',
    subjects: [{ id: 2, name: 'Physics' }],
    mustChangePassword: true,
    createdAt: '2026-10-11T09:00:00.000Z',
  };

  it('lists accounts and subjects from the content-lead routes', async () => {
    const accounts = fakeFetch([{ status: 200, body: { accounts: [account] } }]);
    expect(await createApiClient(accounts.fetchImpl).listReviewerAccounts('tok')).toEqual({
      ok: true,
      accounts: [account],
    });
    expect(accounts.calls[0]?.url).toBe('/api/content-lead/reviewers');

    const subjects = fakeFetch([{ status: 200, body: { subjects: [{ id: 2, name: 'Physics' }] } }]);
    expect(await createApiClient(subjects.fetchImpl).listSubjects('tok')).toEqual({
      ok: true,
      subjects: [{ id: 2, name: 'Physics' }],
    });
    expect(subjects.calls[0]?.url).toBe('/api/content-lead/subjects');
  });

  it('reports forbidden on 403 from the list routes', async () => {
    const { fetchImpl } = fakeFetch([{ status: 403, body: { error: 'content_lead role required' } }]);
    expect(await createApiClient(fetchImpl).listReviewerAccounts('tok')).toEqual({
      ok: false,
      reason: 'forbidden',
    });
  });

  it('creates an account, returning the temporary password', async () => {
    const input = {
      fullName: 'Adaeze Okafor',
      phone: '+2348031234567',
      email: 'adaeze@example.test',
      role: 'reviewer' as const,
      subjectIds: [2],
    };
    const { fetchImpl, calls } = fakeFetch([
      { status: 201, body: { reviewerId: 4, temporaryPassword: 'TempPass2345' } },
    ]);

    expect(await createApiClient(fetchImpl).createReviewerAccount('tok', input)).toEqual({
      ok: true,
      reviewerId: 4,
      temporaryPassword: 'TempPass2345',
    });
    expect(calls[0]).toMatchObject({
      url: '/api/content-lead/reviewers',
      method: 'POST',
      body: input,
    });
  });

  it('maps the named create failures to their own reasons', async () => {
    const input = {
      fullName: 'A',
      phone: '+2348031234567',
      email: 'a@example.test',
      role: 'contributor' as const,
      subjectIds: [],
    };
    for (const [status, error] of [
      [409, 'phone_taken'],
      [409, 'email_taken'],
      [400, 'unknown_subject'],
    ] as const) {
      const { fetchImpl } = fakeFetch([{ status, body: { error } }]);
      expect(await createApiClient(fetchImpl).createReviewerAccount('tok', input)).toEqual({
        ok: false,
        reason: error,
      });
    }
  });

  it('resets a password, telling not_manageable apart from forbidden by the error body', async () => {
    const ok = fakeFetch([{ status: 200, body: { temporaryPassword: 'FreshPass678' } }]);
    expect(await createApiClient(ok.fetchImpl).resetReviewerPassword('tok', 5)).toEqual({
      ok: true,
      temporaryPassword: 'FreshPass678',
    });
    expect(ok.calls[0]).toMatchObject({
      url: '/api/content-lead/reviewers/5/reset-password',
      method: 'POST',
    });

    const notManageable = fakeFetch([{ status: 403, body: { error: 'not_manageable' } }]);
    expect(await createApiClient(notManageable.fetchImpl).resetReviewerPassword('tok', 5)).toEqual({
      ok: false,
      reason: 'not_manageable',
    });

    const forbidden = fakeFetch([{ status: 403, body: { error: 'content_lead role required' } }]);
    expect(await createApiClient(forbidden.fetchImpl).resetReviewerPassword('tok', 5)).toEqual({
      ok: false,
      reason: 'forbidden',
    });

    const missing = fakeFetch([{ status: 404, body: { error: 'not_found' } }]);
    expect(await createApiClient(missing.fetchImpl).resetReviewerPassword('tok', 5)).toEqual({
      ok: false,
      reason: 'not_found',
    });
  });

  it('sets a status, reporting ok on 204', async () => {
    const { fetchImpl, calls } = fakeFetch([{ status: 204 }]);
    expect(await createApiClient(fetchImpl).setReviewerStatus('tok', 5, 'suspended')).toEqual({
      ok: true,
    });
    expect(calls[0]).toMatchObject({
      url: '/api/content-lead/reviewers/5/status',
      method: 'POST',
      body: { status: 'suspended' },
    });
  });
});
