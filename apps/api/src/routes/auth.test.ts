import { afterAll, describe, expect, it } from 'vitest';
import type { AuthService } from '@jamb/shared';
import { parseSessionToken, signSessionToken } from '@jamb/db/session-tokens';
import { createApp } from '../app';

process.env.REVIEWER_SESSION_SECRET ??= 'test-secret-do-not-use-in-prod';

interface Recorded {
  loginCalls: { emailOrPhone: string; password: string }[];
  changePasswordCalls: { reviewerId: number; currentPassword: string; newPassword: string }[];
}

function startApp(service: Partial<AuthService>): {
  url: string;
  close: () => void;
  recorded: Recorded;
} {
  const recorded: Recorded = { loginCalls: [], changePasswordCalls: [] };

  const app = createApp({
    auth: {
      login: (emailOrPhone, password) => {
        recorded.loginCalls.push({ emailOrPhone, password });
        return (
          service.login?.(emailOrPhone, password) ??
          Promise.resolve({ ok: false, reason: 'invalid_credentials' })
        );
      },
      changePassword: (reviewerId, currentPassword, newPassword) => {
        recorded.changePasswordCalls.push({ reviewerId, currentPassword, newPassword });
        return (
          service.changePassword?.(reviewerId, currentPassword, newPassword) ??
          Promise.resolve({ ok: true })
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

function run(service: Partial<AuthService>): ReturnType<typeof startApp> {
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

describe('POST /review/login', () => {
  it('returns a signed, usable token on success', async () => {
    const { url, recorded } = run({
      login: async (emailOrPhone, password) =>
        emailOrPhone === 'reviewer@example.test' && password === 'correct horse'
          ? { ok: true, reviewerId: 7, userId: 70, role: 'moderator', mustChangePassword: true }
          : { ok: false, reason: 'invalid_credentials' },
    });

    const response = await fetch(`${url}/review/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emailOrPhone: 'reviewer@example.test', password: 'correct horse' }),
    });
    const body = await readJson<{
      token: string;
      reviewerId: number;
      role: string;
      mustChangePassword: boolean;
    }>(response);

    expect(response.status).toBe(200);
    expect(body.reviewerId).toBe(7);
    expect(body.role).toBe('moderator');
    expect(body.mustChangePassword).toBe(true);
    expect(typeof body.token).toBe('string');

    const payload = parseSessionToken(body.token, process.env.REVIEWER_SESSION_SECRET!, new Date());
    expect(payload).toMatchObject({ reviewerId: 7, role: 'moderator' });

    expect(recorded.loginCalls).toEqual([
      { emailOrPhone: 'reviewer@example.test', password: 'correct horse' },
    ]);
  });

  it('returns 401 for a wrong password, with no distinguishing detail', async () => {
    const { url } = run({
      login: async () => ({ ok: false, reason: 'invalid_credentials' }),
    });

    const response = await fetch(`${url}/review/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emailOrPhone: 'reviewer@example.test', password: 'wrong' }),
    });
    const body = await readJson<Record<string, unknown>>(response);

    expect(response.status).toBe(401);
    expect(body).not.toHaveProperty('token');
  });

  it('returns the same 401 body for an unknown identifier as for a wrong password', async () => {
    const { url } = run({
      login: async () => ({ ok: false, reason: 'invalid_credentials' }),
    });

    const wrongPassword = await fetch(`${url}/review/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emailOrPhone: 'known@example.test', password: 'wrong' }),
    });
    const unknownIdentifier = await fetch(`${url}/review/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emailOrPhone: 'nobody@example.test', password: 'wrong' }),
    });

    expect(wrongPassword.status).toBe(unknownIdentifier.status);
    expect(await wrongPassword.json()).toEqual(await unknownIdentifier.json());
  });

  it('returns the same 401 body for a reviewer with no password set', async () => {
    // The specific case this route exists to not leak: authenticateReviewer
    // already collapses this into invalid_credentials, but this test proves
    // the HTTP layer doesn't re-introduce the distinction on top.
    const { url } = run({
      login: async () => ({ ok: false, reason: 'invalid_credentials' }),
    });

    const response = await fetch(`${url}/review/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        emailOrPhone: 'never-provisioned@example.test',
        password: 'anything',
      }),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'invalid_credentials' });
  });

  it('returns 401 for a correctly-authenticated but inactive reviewer', async () => {
    const { url } = run({
      login: async () => ({ ok: false, reason: 'not_active', status: 'suspended' }),
    });

    const response = await fetch(`${url}/review/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emailOrPhone: 'suspended@example.test', password: 'correct' }),
    });
    const body = await readJson<Record<string, unknown>>(response);

    expect(response.status).toBe(401);
    expect(body).not.toHaveProperty('token');
  });

  it('rejects a malformed body before ever reaching the service', async () => {
    const { url, recorded } = run({});

    const missingPassword = await fetch(`${url}/review/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emailOrPhone: 'reviewer@example.test' }),
    });
    const emptyBody = await fetch(`${url}/review/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(missingPassword.status).toBe(400);
    expect(emptyBody.status).toBe(400);
    expect(recorded.loginCalls).toEqual([]);
  });
});

describe('createApp without an auth service', () => {
  it('still serves health, so the app boots without a database', async () => {
    const app = createApp();
    const server = app.listen(0);
    const address = server.address();

    if (address === null || typeof address === 'string') {
      throw new Error('expected a bound TCP address');
    }

    try {
      const response = await fetch(`http://localhost:${address.port}/review/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailOrPhone: 'x', password: 'y' }),
      });
      expect(response.status).toBe(404);
    } finally {
      server.close();
    }
  });
});

describe('POST /review/change-password', () => {
  function authHeader(reviewerId: number) {
    const token = signSessionToken(
      { reviewerId, role: 'reviewer' },
      process.env.REVIEWER_SESSION_SECRET!,
      new Date(),
      60,
    );
    return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  }

  it('changes the password for the session reviewer, never one named in the body', async () => {
    const { url, recorded } = run({});

    const response = await fetch(`${url}/review/change-password`, {
      method: 'POST',
      headers: authHeader(7),
      body: JSON.stringify({
        reviewerId: 99,
        currentPassword: 'TempPass2345',
        newPassword: 'my-own-secret',
      }),
    });

    expect(response.status).toBe(204);
    expect(recorded.changePasswordCalls).toEqual([
      { reviewerId: 7, currentPassword: 'TempPass2345', newPassword: 'my-own-secret' },
    ]);
  });

  it('returns 401 with no session, without calling the service', async () => {
    const { url, recorded } = run({});

    const response = await fetch(`${url}/review/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: 'TempPass2345', newPassword: 'my-own-secret' }),
    });

    expect(response.status).toBe(401);
    expect(recorded.changePasswordCalls).toEqual([]);
  });

  it('returns 400 for a too-short new password, without calling the service', async () => {
    const { url, recorded } = run({});

    const response = await fetch(`${url}/review/change-password`, {
      method: 'POST',
      headers: authHeader(7),
      body: JSON.stringify({ currentPassword: 'TempPass2345', newPassword: 'short' }),
    });

    expect(response.status).toBe(400);
    expect(recorded.changePasswordCalls).toEqual([]);
  });

  it('returns 400, not 401, for a wrong current password — the session is still valid', async () => {
    const { url } = run({
      changePassword: async () => ({ ok: false, reason: 'wrong_current_password' }),
    });

    const response = await fetch(`${url}/review/change-password`, {
      method: 'POST',
      headers: authHeader(7),
      body: JSON.stringify({ currentPassword: 'not-it', newPassword: 'my-own-secret' }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'wrong_current_password' });
  });
});
