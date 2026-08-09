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
      response.status === 204 || response.body === undefined
        ? null
        : JSON.stringify(response.body),
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

    expect(result).toEqual({ ok: true, token: 'tok123', reviewerId: 7, role: 'reviewer' });
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
        body: { correctOption: 'C', explanation: 'Because...', verdict: 'agreed', agreesWithKey: true },
      },
    ]);
    const client = createApiClient(fetchImpl);

    const result = await client.reveal('tok123', 9);

    expect(calls[0]).toMatchObject({ url: '/api/review/9/reveal', method: 'GET' });
    expect(result).toEqual({
      ok: true,
      result: { correctOption: 'C', explanation: 'Because...', verdict: 'agreed', agreesWithKey: true },
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
      { status: 200, body: { itemId: 9, status: 'approved_uncalibrated', approvalRoute: 'human_reviewed' } },
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
    });
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
      { status: 200, body: { itemId: 9, status: 'approved_uncalibrated', approvalRoute: 'human_reviewed' } },
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
