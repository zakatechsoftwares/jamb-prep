import { afterAll, describe, expect, it } from 'vitest';
import type { ReviewEscalationService } from '@jamb/shared';
import { signSessionToken } from '@jamb/db/session-tokens';
import { createApp } from '../app';

process.env.REVIEWER_SESSION_SECRET ??= 'test-secret-do-not-use-in-prod';

function authHeader(reviewerId: number, role: 'reviewer' | 'moderator' = 'moderator') {
  const token = signSessionToken(
    { reviewerId, role },
    process.env.REVIEWER_SESSION_SECRET!,
    new Date(),
    60,
  );
  return { Authorization: `Bearer ${token}` };
}

interface Recorded {
  resolveCalls: { reviewerId: number; itemId: number; input: unknown }[];
}

function startApp(service: Partial<ReviewEscalationService>): {
  url: string;
  close: () => void;
  recorded: Recorded;
} {
  const recorded: Recorded = { resolveCalls: [] };

  const app = createApp({
    reviewEscalation: {
      resolveEscalation: (reviewerId, itemId, input) => {
        recorded.resolveCalls.push({ reviewerId, itemId, input });
        return (
          service.resolveEscalation?.(reviewerId, itemId, input) ??
          Promise.resolve({
            ok: true,
            itemId,
            status: 'approved_uncalibrated',
            approvalRoute: 'moderator_ruled',
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

function run(service: Partial<ReviewEscalationService>): ReturnType<typeof startApp> {
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

describe('POST /review/:itemId/resolve-escalation', () => {
  it('lets a moderator approve, returning the resulting status', async () => {
    const { url, recorded } = run({
      resolveEscalation: async () => ({
        ok: true,
        itemId: 9,
        status: 'approved_uncalibrated',
        approvalRoute: 'moderator_ruled',
        decisionContext: 'live',
      }),
    });

    const response = await fetch(`${url}/review/9/resolve-escalation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(5) },
      body: JSON.stringify({ action: 'approve' }),
    });
    const body = await readJson<Record<string, unknown>>(response);

    expect(response.status).toBe(200);
    expect(body).toEqual({
      itemId: 9,
      status: 'approved_uncalibrated',
      approvalRoute: 'moderator_ruled',
    });
    expect(recorded.resolveCalls).toEqual([
      { reviewerId: 5, itemId: 9, input: { action: 'approve' } },
    ]);
  });

  it('lets a moderator reject', async () => {
    const { url } = run({
      resolveEscalation: async () => ({
        ok: true,
        itemId: 9,
        status: 'rejected',
        approvalRoute: null,
        decisionContext: 'live',
      }),
    });

    const response = await fetch(`${url}/review/9/resolve-escalation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(5) },
      body: JSON.stringify({ action: 'reject' }),
    });

    expect(response.status).toBe(200);
    expect(await readJson<Record<string, unknown>>(response)).toEqual({
      itemId: 9,
      status: 'rejected',
      approvalRoute: null,
    });
  });

  it('rejects an unrecognised action before ever reaching the service', async () => {
    const { url, recorded } = run({});

    const response = await fetch(`${url}/review/9/resolve-escalation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(5) },
      body: JSON.stringify({ action: 'escalate' }),
    });

    expect(response.status).toBe(400);
    expect(recorded.resolveCalls).toEqual([]);
  });

  it('rejects edit_and_approve, which is not a valid ruling here', async () => {
    const { url, recorded } = run({});

    const response = await fetch(`${url}/review/9/resolve-escalation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(5) },
      body: JSON.stringify({ action: 'edit_and_approve', edits: { stem: 'x' } }),
    });

    expect(response.status).toBe(400);
    expect(recorded.resolveCalls).toEqual([]);
  });

  it('returns 409 with the state machine message when the transition is invalid', async () => {
    const { url } = run({
      resolveEscalation: async () => ({
        ok: false,
        reason: 'invalid_transition',
        message: 'transition: moderator_ruled is not a legal transition from pending_review',
      }),
    });

    const response = await fetch(`${url}/review/9/resolve-escalation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(5) },
      body: JSON.stringify({ action: 'approve' }),
    });
    const body = await readJson<{ message: string }>(response);

    expect(response.status).toBe(409);
    expect(body.message).toMatch(/not a legal transition/);
  });

  it('rejects a malformed itemId', async () => {
    const { url } = run({});

    const response = await fetch(`${url}/review/x/resolve-escalation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(5) },
      body: JSON.stringify({ action: 'approve' }),
    });

    expect(response.status).toBe(400);
  });

  it('rejects a request with no session', async () => {
    const { url, recorded } = run({});

    const response = await fetch(`${url}/review/9/resolve-escalation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve' }),
    });

    expect(response.status).toBe(401);
    expect(recorded.resolveCalls).toEqual([]);
  });

  it('rejects a non-moderator session with 403, never reaching the service', async () => {
    const { url, recorded } = run({});

    const response = await fetch(`${url}/review/9/resolve-escalation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(5, 'reviewer') },
      body: JSON.stringify({ action: 'approve' }),
    });

    expect(response.status).toBe(403);
    expect(recorded.resolveCalls).toEqual([]);
  });
});
