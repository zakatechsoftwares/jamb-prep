import { afterAll, describe, expect, it } from 'vitest';
import type { IllustrationBoardService, IllustrationTicketSummary } from '@jamb/shared';
import { signSessionToken } from '@jamb/db/session-tokens';
import { createApp } from '../app';

process.env.REVIEWER_SESSION_SECRET ??= 'test-secret-do-not-use-in-prod';

function authHeader(reviewerId: number, role: 'reviewer' | 'contributor' = 'reviewer') {
  const token = signSessionToken(
    { reviewerId, role },
    process.env.REVIEWER_SESSION_SECRET!,
    new Date(),
    60,
  );
  return { Authorization: `Bearer ${token}` };
}

function ticket(id: number, overrides: Partial<IllustrationTicketSummary> = {}): IllustrationTicketSummary {
  return {
    id,
    itemId: 100 + id,
    figureDescription: 'A free-body diagram of a block on an incline.',
    status: 'open',
    claimedByUserId: null,
    ...overrides,
  };
}

interface Recorded {
  listCalls: number;
  claimCalls: { ticketId: number; illustratorReviewerId: number }[];
  completeCalls: { ticketId: number; illustratorReviewerId: number; input: unknown }[];
  sketchPhotoCalls: number[];
}

function startApp(service: Partial<IllustrationBoardService>): {
  url: string;
  close: () => void;
  recorded: Recorded;
} {
  const recorded: Recorded = { listCalls: 0, claimCalls: [], completeCalls: [], sketchPhotoCalls: [] };

  const app = createApp({
    illustrationBoard: {
      listOpenTickets: () => {
        recorded.listCalls += 1;
        return service.listOpenTickets?.() ?? Promise.resolve([]);
      },
      claimTicket: (ticketId, illustratorReviewerId) => {
        recorded.claimCalls.push({ ticketId, illustratorReviewerId });
        return (
          service.claimTicket?.(ticketId, illustratorReviewerId) ??
          Promise.resolve(ticket(ticketId, { status: 'claimed' }))
        );
      },
      completeTicket: (ticketId, illustratorReviewerId, input) => {
        recorded.completeCalls.push({ ticketId, illustratorReviewerId, input });
        return service.completeTicket?.(ticketId, illustratorReviewerId, input) ?? Promise.resolve({ ok: true });
      },
      loadSketchPhoto: (ticketId) => {
        recorded.sketchPhotoCalls.push(ticketId);
        return (
          service.loadSketchPhoto?.(ticketId) ??
          Promise.resolve({ bytes: new Uint8Array([1, 2, 3]), contentType: 'image/jpeg' })
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
function run(service: Partial<IllustrationBoardService>): ReturnType<typeof startApp> {
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

describe('GET /illustration-tickets', () => {
  it('lists open tickets for any active session, not just an illustrator role', async () => {
    const { url, recorded } = run({ listOpenTickets: async () => [ticket(1), ticket(2)] });

    const response = await fetch(`${url}/illustration-tickets`, { headers: authHeader(9, 'contributor') });
    const body = await readJson<{ tickets: IllustrationTicketSummary[] }>(response);

    expect(response.status).toBe(200);
    expect(body.tickets.map((t) => t.id)).toEqual([1, 2]);
    expect(recorded.listCalls).toBe(1);
  });

  it('rejects a request with no session', async () => {
    const { url } = run({});
    expect((await fetch(`${url}/illustration-tickets`)).status).toBe(401);
  });
});

describe('POST /illustration-tickets/:id/claim', () => {
  it('claims the ticket as the authenticated reviewer, never a body-supplied id', async () => {
    const { url, recorded } = run({});

    const response = await fetch(`${url}/illustration-tickets/7/claim`, {
      method: 'POST',
      headers: authHeader(3),
    });
    const body = await readJson<IllustrationTicketSummary>(response);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ id: 7, status: 'claimed' });
    expect(recorded.claimCalls).toEqual([{ ticketId: 7, illustratorReviewerId: 3 }]);
  });

  it('rejects a non-numeric ticket id', async () => {
    const { url } = run({});
    expect(
      (await fetch(`${url}/illustration-tickets/not-a-number/claim`, {
        method: 'POST',
        headers: authHeader(3),
      })).status,
    ).toBe(400);
  });

  it('rejects a request with no session', async () => {
    const { url } = run({});
    expect((await fetch(`${url}/illustration-tickets/7/claim`, { method: 'POST' })).status).toBe(401);
  });

  it('propagates a not-claimable ticket as an error response rather than a fabricated success', async () => {
    const { url } = run({
      claimTicket: async () => {
        throw new Error('illustration ticket 7 is not claimable (status: claimed)');
      },
    });

    const response = await fetch(`${url}/illustration-tickets/7/claim`, {
      method: 'POST',
      headers: authHeader(3),
    });
    expect(response.status).toBe(500);
  });
});

describe('POST /illustration-tickets/:id/complete', () => {
  it('completes with svgMarkup and altText', async () => {
    const { url, recorded } = run({});

    const response = await fetch(`${url}/illustration-tickets/7/complete`, {
      method: 'POST',
      headers: { ...authHeader(3), 'content-type': 'application/json' },
      body: JSON.stringify({ svgMarkup: '<svg></svg>', altText: 'a diagram' }),
    });

    expect(response.status).toBe(200);
    expect(recorded.completeCalls).toEqual([
      { ticketId: 7, illustratorReviewerId: 3, input: { svgMarkup: '<svg></svg>', altText: 'a diagram' } },
    ]);
  });

  it('rejects a missing svgMarkup', async () => {
    const { url } = run({});
    const response = await fetch(`${url}/illustration-tickets/7/complete`, {
      method: 'POST',
      headers: { ...authHeader(3), 'content-type': 'application/json' },
      body: JSON.stringify({ altText: 'a diagram' }),
    });
    expect(response.status).toBe(400);
  });

  it('rejects a missing altText', async () => {
    const { url } = run({});
    const response = await fetch(`${url}/illustration-tickets/7/complete`, {
      method: 'POST',
      headers: { ...authHeader(3), 'content-type': 'application/json' },
      body: JSON.stringify({ svgMarkup: '<svg></svg>' }),
    });
    expect(response.status).toBe(400);
  });

  it('rejects a request with no session', async () => {
    const { url } = run({});
    const response = await fetch(`${url}/illustration-tickets/7/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ svgMarkup: '<svg></svg>', altText: 'a diagram' }),
    });
    expect(response.status).toBe(401);
  });
});

describe('GET /illustration-tickets/:id/sketch-photo', () => {
  it('serves the raw bytes with the stored content type', async () => {
    const { url, recorded } = run({
      loadSketchPhoto: async () => ({ bytes: new Uint8Array([9, 9, 9]), contentType: 'image/png' }),
    });

    const response = await fetch(`${url}/illustration-tickets/7/sketch-photo`, {
      headers: authHeader(3),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([9, 9, 9]);
    expect(recorded.sketchPhotoCalls).toEqual([7]);
  });

  it('reports 404 for an unknown ticket', async () => {
    const { url } = run({ loadSketchPhoto: async () => null });

    const response = await fetch(`${url}/illustration-tickets/7/sketch-photo`, {
      headers: authHeader(3),
    });
    expect(response.status).toBe(404);
  });

  it('rejects a request with no session', async () => {
    const { url } = run({});
    expect((await fetch(`${url}/illustration-tickets/7/sketch-photo`)).status).toBe(401);
  });
});
