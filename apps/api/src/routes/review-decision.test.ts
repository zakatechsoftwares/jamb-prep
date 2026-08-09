import { afterAll, describe, expect, it } from 'vitest';
import type { ReviewDecisionService } from '@jamb/shared';
import { signSessionToken } from '@jamb/db/session-tokens';
import { createApp } from '../app';

process.env.REVIEWER_SESSION_SECRET ??= 'test-secret-do-not-use-in-prod';

function authHeader(reviewerId: number, role: 'reviewer' | 'moderator' = 'reviewer') {
  const token = signSessionToken(
    { reviewerId, role },
    process.env.REVIEWER_SESSION_SECRET!,
    new Date(),
    60,
  );
  return { Authorization: `Bearer ${token}` };
}

interface Recorded {
  solveCalls: { reviewerId: number; itemId: number; answer: string }[];
  revealCalls: { reviewerId: number; itemId: number }[];
  decideCalls: { reviewerId: number; itemId: number; input: unknown }[];
}

function startApp(service: Partial<ReviewDecisionService>): {
  url: string;
  close: () => void;
  recorded: Recorded;
} {
  const recorded: Recorded = { solveCalls: [], revealCalls: [], decideCalls: [] };

  const app = createApp({
    reviewDecision: {
      submitBlindAnswer: (reviewerId, itemId, answer) => {
        recorded.solveCalls.push({ reviewerId, itemId, answer });
        return (
          service.submitBlindAnswer?.(reviewerId, itemId, answer) ??
          Promise.resolve({ ok: true, itemId, answer })
        );
      },
      revealItem: (reviewerId, itemId) => {
        recorded.revealCalls.push({ reviewerId, itemId });
        return (
          service.revealItem?.(reviewerId, itemId) ??
          Promise.resolve({ ok: false, reason: 'not_claimed_by_you' })
        );
      },
      decideOnItem: (reviewerId, itemId, input) => {
        recorded.decideCalls.push({ reviewerId, itemId, input });
        return (
          service.decideOnItem?.(reviewerId, itemId, input) ??
          Promise.resolve({
            ok: true,
            itemId,
            status: 'approved_uncalibrated',
            approvalRoute: null,
            decisionContext: 'live',
          })
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

function run(service: Partial<ReviewDecisionService>): ReturnType<typeof startApp> {
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

describe('POST /review/:itemId/solve', () => {
  it('records the answer and returns it', async () => {
    const { url, recorded } = run({
      submitBlindAnswer: async (reviewerId, itemId, answer) => ({ ok: true, itemId, answer }),
    });

    const response = await fetch(`${url}/review/9/solve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(3) },
      body: JSON.stringify({ answer: 'B' }),
    });
    const body = await readJson<{ itemId: number; answer: string }>(response);

    expect(response.status).toBe(200);
    expect(body).toEqual({ itemId: 9, answer: 'B' });
    expect(recorded.solveCalls).toEqual([{ reviewerId: 3, itemId: 9, answer: 'B' }]);
  });

  it('rejects an answer outside A-D before ever reaching the service', async () => {
    const { url, recorded } = run({});

    const response = await fetch(`${url}/review/9/solve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(3) },
      body: JSON.stringify({ answer: 'E' }),
    });

    expect(response.status).toBe(400);
    expect(recorded.solveCalls).toEqual([]);
  });

  it('returns 403 when the item is not currently claimed by this reviewer', async () => {
    const { url } = run({
      submitBlindAnswer: async () => ({ ok: false, reason: 'not_claimed_by_you' }),
    });

    const response = await fetch(`${url}/review/9/solve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(3) },
      body: JSON.stringify({ answer: 'A' }),
    });

    expect(response.status).toBe(403);
  });

  it('returns 409 when an answer is already recorded for this claim', async () => {
    // The immutability control, at the HTTP layer: a reviewer who has
    // already answered gets a conflict, not a silent overwrite.
    const { url } = run({
      submitBlindAnswer: async () => ({ ok: false, reason: 'already_answered' }),
    });

    const response = await fetch(`${url}/review/9/solve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(3) },
      body: JSON.stringify({ answer: 'A' }),
    });

    expect(response.status).toBe(409);
  });

  it('rejects a malformed itemId', async () => {
    const { url } = run({});

    expect(
      (
        await fetch(`${url}/review/not-a-number/solve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeader(3) },
          body: JSON.stringify({ answer: 'A' }),
        })
      ).status,
    ).toBe(400);
  });

  it('rejects a request with no session', async () => {
    const { url, recorded } = run({});

    const response = await fetch(`${url}/review/9/solve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answer: 'A' }),
    });

    expect(response.status).toBe(401);
    expect(recorded.solveCalls).toEqual([]);
  });
});

describe('GET /review/:itemId/reveal', () => {
  it('withholds the key when the outcome is not ok', async () => {
    // The DONE WHEN criterion at the HTTP boundary: whatever the reason,
    // a not-ok outcome never carries a key, an explanation or a verdict.
    const { url } = run({
      revealItem: async () => ({ ok: false, reason: 'not_yet_solved' }),
    });

    const response = await fetch(`${url}/review/9/reveal`, { headers: authHeader(3) });
    const body = await readJson<Record<string, unknown>>(response);

    expect(response.status).toBe(403);
    expect(body).not.toHaveProperty('correctOption');
    expect(body).not.toHaveProperty('explanation');
    expect(JSON.stringify(body)).not.toMatch(/[ABCD]/);
  });

  it('returns 403 for an item this reviewer does not currently hold, same as an unsolved one', async () => {
    const { url } = run({
      revealItem: async () => ({ ok: false, reason: 'not_claimed_by_you' }),
    });

    const response = await fetch(`${url}/review/9/reveal`, { headers: authHeader(3) });
    expect(response.status).toBe(403);
  });

  it('returns the key, explanation, verdict and agreement once permitted', async () => {
    const { url, recorded } = run({
      revealItem: async () => ({
        ok: true,
        correctOption: 'C',
        explanation: 'Because...',
        verdict: 'agreed',
        agreesWithKey: true,
      }),
    });

    const response = await fetch(`${url}/review/9/reveal`, { headers: authHeader(3) });
    const body = await readJson<Record<string, unknown>>(response);

    expect(response.status).toBe(200);
    expect(body).toEqual({
      correctOption: 'C',
      explanation: 'Because...',
      verdict: 'agreed',
      agreesWithKey: true,
    });
    expect(recorded.revealCalls).toEqual([{ reviewerId: 3, itemId: 9 }]);
  });

  it('rejects a malformed itemId', async () => {
    const { url } = run({});

    expect((await fetch(`${url}/review/x/reveal`, { headers: authHeader(3) })).status).toBe(400);
  });

  it('rejects a request with no session', async () => {
    const { url } = run({});

    expect((await fetch(`${url}/review/9/reveal`)).status).toBe(401);
  });
});

describe('POST /review/:itemId/decide', () => {
  it('accepts a bare approve and returns the resulting status', async () => {
    const { url, recorded } = run({
      decideOnItem: async () => ({
        ok: true,
        itemId: 9,
        status: 'approved_uncalibrated',
        approvalRoute: 'human_reviewed',
        decisionContext: 'live',
      }),
    });

    const response = await fetch(`${url}/review/9/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(3) },
      body: JSON.stringify({ action: 'approve' }),
    });
    const body = await readJson<Record<string, unknown>>(response);

    expect(response.status).toBe(200);
    expect(body).toEqual({
      itemId: 9,
      status: 'approved_uncalibrated',
      approvalRoute: 'human_reviewed',
      decisionContext: 'live',
    });
    expect(recorded.decideCalls[0]?.input).toMatchObject({ action: 'approve' });
  });

  it('rejects a free-text rejection reason before ever reaching the service', async () => {
    // The DONE WHEN criterion, at the HTTP boundary this time: a plausible
    // free-text reason is refused exactly like nonsense would be.
    const { url, recorded } = run({});

    const response = await fetch(`${url}/review/9/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(3) },
      body: JSON.stringify({ action: 'reject', rejectionReason: 'this key looks wrong to me' }),
    });

    expect(response.status).toBe(400);
    expect(recorded.decideCalls).toEqual([]);
  });

  it('rejects an unrecognised action before ever reaching the service', async () => {
    const { url, recorded } = run({});

    const response = await fetch(`${url}/review/9/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(3) },
      body: JSON.stringify({ action: 'bulk_approve' }),
    });

    expect(response.status).toBe(400);
    expect(recorded.decideCalls).toEqual([]);
  });

  it('accepts a reject with a valid structured reason', async () => {
    const { url } = run({
      decideOnItem: async () => ({
        ok: true,
        itemId: 9,
        status: 'rejected',
        approvalRoute: null,
        decisionContext: 'live',
      }),
    });

    const response = await fetch(`${url}/review/9/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(3) },
      body: JSON.stringify({ action: 'reject', rejectionReason: 'wrong_key' }),
    });

    expect(response.status).toBe(200);
  });

  it('returns 403 when the item is not currently claimed by this reviewer', async () => {
    const { url } = run({
      decideOnItem: async () => ({ ok: false, reason: 'not_claimed_by_you' }),
    });

    const response = await fetch(`${url}/review/9/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(3) },
      body: JSON.stringify({ action: 'approve' }),
    });

    expect(response.status).toBe(403);
  });

  it('returns 409 with the state machine message when the transition is invalid', async () => {
    const { url } = run({
      decideOnItem: async () => ({
        ok: false,
        reason: 'invalid_transition',
        message: 'transition: this reviewer has already decided on the item',
      }),
    });

    const response = await fetch(`${url}/review/9/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(3) },
      body: JSON.stringify({ action: 'approve' }),
    });
    const body = await readJson<{ message: string }>(response);

    expect(response.status).toBe(409);
    expect(body.message).toMatch(/already decided/);
  });

  it('passes an edit_and_approve patch through to the service untouched', async () => {
    const { url, recorded } = run({
      decideOnItem: async () => ({
        ok: true,
        itemId: 9,
        status: 'approved_uncalibrated',
        approvalRoute: 'human_reviewed',
        decisionContext: 'live',
      }),
    });

    const edits = { stem: 'Corrected stem' };
    const response = await fetch(`${url}/review/9/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(3) },
      body: JSON.stringify({ action: 'edit_and_approve', edits }),
    });

    expect(response.status).toBe(200);
    expect(recorded.decideCalls[0]?.input).toMatchObject({
      action: 'edit_and_approve',
      edits,
    });
  });

  it('rejects a malformed itemId', async () => {
    const { url } = run({});

    expect(
      (
        await fetch(`${url}/review/x/decide`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeader(3) },
          body: JSON.stringify({ action: 'approve' }),
        })
      ).status,
    ).toBe(400);
  });

  it('rejects a request with no session', async () => {
    const { url, recorded } = run({});

    const response = await fetch(`${url}/review/9/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve' }),
    });

    expect(response.status).toBe(401);
    expect(recorded.decideCalls).toEqual([]);
  });
});
