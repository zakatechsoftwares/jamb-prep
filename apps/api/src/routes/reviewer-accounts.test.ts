import { afterAll, describe, expect, it } from 'vitest';
import type { PanelRole, ReviewerAccountService } from '@jamb/shared';
import { signSessionToken } from '@jamb/db/session-tokens';
import { createApp } from '../app';

process.env.REVIEWER_SESSION_SECRET ??= 'test-secret-do-not-use-in-prod';

function authHeader(reviewerId: number, role: PanelRole = 'content_lead') {
  const token = signSessionToken(
    { reviewerId, role },
    process.env.REVIEWER_SESSION_SECRET!,
    new Date(),
    60,
  );
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

interface Recorded {
  createCalls: unknown[];
  resetCalls: number[];
  statusCalls: { reviewerId: number; status: string }[];
  listCalls: number;
}

const servers: { close: () => void }[] = [];

afterAll(() => {
  for (const server of servers) {
    server.close();
  }
});

function run(service: Partial<ReviewerAccountService>): { url: string; recorded: Recorded } {
  const recorded: Recorded = { createCalls: [], resetCalls: [], statusCalls: [], listCalls: 0 };

  const app = createApp({
    reviewerAccounts: {
      listAccounts: () => {
        recorded.listCalls += 1;
        return service.listAccounts?.() ?? Promise.resolve([]);
      },
      listSubjects: () => service.listSubjects?.() ?? Promise.resolve([]),
      createAccount: (input) => {
        recorded.createCalls.push(input);
        return (
          service.createAccount?.(input) ??
          Promise.resolve({ ok: true, reviewerId: 12, temporaryPassword: 'TempPass2345' })
        );
      },
      resetPassword: (reviewerId) => {
        recorded.resetCalls.push(reviewerId);
        return (
          service.resetPassword?.(reviewerId) ??
          Promise.resolve({ ok: true, temporaryPassword: 'FreshPass678' })
        );
      },
      setStatus: (reviewerId, status) => {
        recorded.statusCalls.push({ reviewerId, status });
        return service.setStatus?.(reviewerId, status) ?? Promise.resolve({ ok: true });
      },
    },
  });

  const server = app.listen(0);
  servers.push(server);
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('expected a bound TCP address');
  }

  return { url: `http://localhost:${address.port}`, recorded };
}

const validBody = {
  fullName: 'Adaeze Okafor',
  phone: '+2348031234567',
  email: 'adaeze@example.test',
  role: 'reviewer',
  subjectIds: [2],
};

describe('content-lead gating', () => {
  const routes: { method: string; path: string; body?: unknown }[] = [
    { method: 'GET', path: '/content-lead/reviewers' },
    { method: 'GET', path: '/content-lead/subjects' },
    { method: 'POST', path: '/content-lead/reviewers', body: validBody },
    { method: 'POST', path: '/content-lead/reviewers/5/reset-password' },
    { method: 'POST', path: '/content-lead/reviewers/5/status', body: { status: 'suspended' } },
  ];

  it('returns 401 with no session on every route', async () => {
    const { url, recorded } = run({});
    for (const route of routes) {
      const response = await fetch(`${url}${route.path}`, {
        method: route.method,
        headers: { 'Content-Type': 'application/json' },
        body: route.body === undefined ? undefined : JSON.stringify(route.body),
      });
      expect(response.status, route.path).toBe(401);
    }
    expect(recorded).toEqual({ createCalls: [], resetCalls: [], statusCalls: [], listCalls: 0 });
  });

  it('returns 403 for a non-content-lead session on every route, moderator included', async () => {
    const { url, recorded } = run({});
    for (const role of ['reviewer', 'moderator', 'contributor'] as const) {
      for (const route of routes) {
        const response = await fetch(`${url}${route.path}`, {
          method: route.method,
          headers: authHeader(3, role),
          body: route.body === undefined ? undefined : JSON.stringify(route.body),
        });
        expect(response.status, `${role} ${route.path}`).toBe(403);
      }
    }
    expect(recorded).toEqual({ createCalls: [], resetCalls: [], statusCalls: [], listCalls: 0 });
  });
});

describe('GET /content-lead/reviewers and /subjects', () => {
  it('returns the accounts and subjects wrapped in objects', async () => {
    const account = {
      reviewerId: 4,
      fullName: 'Adaeze Okafor',
      phone: '+2348031234567',
      email: 'adaeze@example.test',
      role: 'reviewer' as const,
      status: 'active' as const,
      subjects: [{ id: 2, name: 'Physics' }],
      mustChangePassword: true,
      createdAt: '2026-10-11T09:00:00.000Z',
    };
    const { url } = run({
      listAccounts: async () => [account],
      listSubjects: async () => [{ id: 2, name: 'Physics' }],
    });

    const accounts = await fetch(`${url}/content-lead/reviewers`, { headers: authHeader(1) });
    expect(await accounts.json()).toEqual({ accounts: [account] });

    const subjects = await fetch(`${url}/content-lead/subjects`, { headers: authHeader(1) });
    expect(await subjects.json()).toEqual({ subjects: [{ id: 2, name: 'Physics' }] });
  });
});

describe('POST /content-lead/reviewers', () => {
  it('returns 201 with the temporary password, uncacheable', async () => {
    const { url, recorded } = run({});

    const response = await fetch(`${url}/content-lead/reviewers`, {
      method: 'POST',
      headers: authHeader(1),
      body: JSON.stringify(validBody),
    });

    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ reviewerId: 12, temporaryPassword: 'TempPass2345' });
    expect(recorded.createCalls).toEqual([validBody]);
  });

  it('returns 400 for an invalid body without calling the service', async () => {
    const { url, recorded } = run({});

    for (const body of [
      { ...validBody, email: '' },
      { ...validBody, role: 'content_lead' },
      { ...validBody, subjectIds: [] },
    ]) {
      const response = await fetch(`${url}/content-lead/reviewers`, {
        method: 'POST',
        headers: authHeader(1),
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
    }
    expect(recorded.createCalls).toEqual([]);
  });

  it('maps a taken phone or email to 409 and an unknown subject to 400', async () => {
    const cases = [
      { reason: 'phone_taken', status: 409 },
      { reason: 'email_taken', status: 409 },
      { reason: 'unknown_subject', status: 400 },
    ] as const;

    for (const { reason, status } of cases) {
      const { url } = run({ createAccount: async () => ({ ok: false, reason }) });
      const response = await fetch(`${url}/content-lead/reviewers`, {
        method: 'POST',
        headers: authHeader(1),
        body: JSON.stringify(validBody),
      });
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: reason });
    }
  });
});

describe('POST /content-lead/reviewers/:reviewerId/reset-password', () => {
  it('returns the new temporary password, uncacheable', async () => {
    const { url, recorded } = run({});

    const response = await fetch(`${url}/content-lead/reviewers/5/reset-password`, {
      method: 'POST',
      headers: authHeader(1),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ temporaryPassword: 'FreshPass678' });
    expect(recorded.resetCalls).toEqual([5]);
  });

  it('maps not_found to 404 and not_manageable to 403', async () => {
    for (const [reason, status] of [
      ['not_found', 404],
      ['not_manageable', 403],
    ] as const) {
      const { url } = run({ resetPassword: async () => ({ ok: false, reason }) });
      const response = await fetch(`${url}/content-lead/reviewers/5/reset-password`, {
        method: 'POST',
        headers: authHeader(1),
      });
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: reason });
    }
  });

  it('returns 400 for a non-numeric reviewer id', async () => {
    const { url, recorded } = run({});
    const response = await fetch(`${url}/content-lead/reviewers/abc/reset-password`, {
      method: 'POST',
      headers: authHeader(1),
    });
    expect(response.status).toBe(400);
    expect(recorded.resetCalls).toEqual([]);
  });
});

describe('POST /content-lead/reviewers/:reviewerId/status', () => {
  it('returns 204 and passes the status through', async () => {
    const { url, recorded } = run({});

    const response = await fetch(`${url}/content-lead/reviewers/5/status`, {
      method: 'POST',
      headers: authHeader(1),
      body: JSON.stringify({ status: 'suspended' }),
    });

    expect(response.status).toBe(204);
    expect(recorded.statusCalls).toEqual([{ reviewerId: 5, status: 'suspended' }]);
  });

  it('returns 400 for a status a content lead may not set, without calling the service', async () => {
    const { url, recorded } = run({});
    const response = await fetch(`${url}/content-lead/reviewers/5/status`, {
      method: 'POST',
      headers: authHeader(1),
      body: JSON.stringify({ status: 'removed' }),
    });
    expect(response.status).toBe(400);
    expect(recorded.statusCalls).toEqual([]);
  });

  it('maps not_manageable to 403', async () => {
    const { url } = run({ setStatus: async () => ({ ok: false, reason: 'not_manageable' }) });
    const response = await fetch(`${url}/content-lead/reviewers/5/status`, {
      method: 'POST',
      headers: authHeader(1),
      body: JSON.stringify({ status: 'active' }),
    });
    expect(response.status).toBe(403);
  });
});
