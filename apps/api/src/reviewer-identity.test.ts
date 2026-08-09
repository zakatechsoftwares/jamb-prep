import { beforeEach, describe, expect, it } from 'vitest';
import type { Request } from 'express';
import { signSessionToken } from '@jamb/db/session-tokens';
import {
  parsePositiveInteger,
  requireContentLead,
  requireModerator,
  resolveReviewerId,
  resolveReviewerSession,
} from './reviewer-identity';

const SECRET = 'test-secret-do-not-use-in-prod';

function requestWithHeader(header: string | undefined): Request {
  return { headers: { authorization: header } } as unknown as Request;
}

// resolveReviewerSession reads the real clock (it's Express middleware, not
// a pure decision function), so a token good for these tests has to be
// signed against actual "now" rather than a fixed past instant.
function tokenFor(
  reviewerId: number,
  role: 'reviewer' | 'moderator' | 'content_lead' = 'reviewer',
): string {
  return signSessionToken({ reviewerId, role }, SECRET, new Date(), 60);
}

describe('resolveReviewerSession / resolveReviewerId', () => {
  beforeEach(() => {
    process.env.REVIEWER_SESSION_SECRET = SECRET;
  });

  it('accepts a valid bearer token', () => {
    const req = requestWithHeader(`Bearer ${tokenFor(7)}`);
    expect(resolveReviewerId(req)).toBe(7);
    expect(resolveReviewerSession(req)).toMatchObject({ reviewerId: 7, role: 'reviewer' });
  });

  it('rejects a missing Authorization header', () => {
    expect(resolveReviewerId(requestWithHeader(undefined))).toBeNull();
    expect(resolveReviewerSession(requestWithHeader(undefined))).toBeNull();
  });

  it('rejects a header with no Bearer scheme', () => {
    expect(resolveReviewerId(requestWithHeader(tokenFor(7)))).toBeNull();
  });

  it('rejects a header with the wrong scheme', () => {
    expect(resolveReviewerId(requestWithHeader(`Basic ${tokenFor(7)}`))).toBeNull();
  });

  it('rejects "Bearer" with no token', () => {
    expect(resolveReviewerId(requestWithHeader('Bearer '))).toBeNull();
    expect(resolveReviewerId(requestWithHeader('Bearer'))).toBeNull();
  });

  it('rejects a token signed with a different secret', () => {
    const token = signSessionToken(
      { reviewerId: 7, role: 'reviewer' },
      'wrong-secret',
      new Date(),
      60,
    );
    expect(resolveReviewerId(requestWithHeader(`Bearer ${token}`))).toBeNull();
  });

  it('rejects a malformed token', () => {
    expect(resolveReviewerId(requestWithHeader('Bearer not-a-real-token'))).toBeNull();
  });

  it('rejects an expired token', () => {
    // signSessionToken/parseSessionToken take an injected clock, but
    // resolveReviewerSession reads the real one — so expiry here is proven
    // by a token whose ttl has already elapsed relative to actual now.
    const longExpired = signSessionToken(
      { reviewerId: 7, role: 'reviewer' },
      SECRET,
      new Date('2000-01-01T00:00:00.000Z'),
      1,
    );
    expect(resolveReviewerId(requestWithHeader(`Bearer ${longExpired}`))).toBeNull();
  });
});

describe('requireModerator', () => {
  beforeEach(() => {
    process.env.REVIEWER_SESSION_SECRET = SECRET;
  });

  function run(req: Request): { status: number; body: unknown; nextCalled: boolean } {
    let status = 0;
    let body: unknown;
    let nextCalled = false;
    const res = {
      status(code: number) {
        status = code;
        return this;
      },
      json(payload: unknown) {
        body = payload;
        return this;
      },
    };
    requireModerator(req, res as never, () => {
      nextCalled = true;
    });
    return { status, body, nextCalled };
  }

  it('calls next for a moderator session', () => {
    const result = run(requestWithHeader(`Bearer ${tokenFor(1, 'moderator')}`));
    expect(result.nextCalled).toBe(true);
    expect(result.status).toBe(0);
  });

  it('responds 401 with no session', () => {
    const result = run(requestWithHeader(undefined));
    expect(result.nextCalled).toBe(false);
    expect(result.status).toBe(401);
  });

  it('responds 403 for a valid session that is not a moderator', () => {
    const result = run(requestWithHeader(`Bearer ${tokenFor(1, 'reviewer')}`));
    expect(result.nextCalled).toBe(false);
    expect(result.status).toBe(403);
  });
});

describe('requireContentLead', () => {
  beforeEach(() => {
    process.env.REVIEWER_SESSION_SECRET = SECRET;
  });

  function run(req: Request): { status: number; body: unknown; nextCalled: boolean } {
    let status = 0;
    let body: unknown;
    let nextCalled = false;
    const res = {
      status(code: number) {
        status = code;
        return this;
      },
      json(payload: unknown) {
        body = payload;
        return this;
      },
    };
    requireContentLead(req, res as never, () => {
      nextCalled = true;
    });
    return { status, body, nextCalled };
  }

  it('calls next for a content-lead session', () => {
    const result = run(requestWithHeader(`Bearer ${tokenFor(1, 'content_lead')}`));
    expect(result.nextCalled).toBe(true);
    expect(result.status).toBe(0);
  });

  it('responds 401 with no session', () => {
    const result = run(requestWithHeader(undefined));
    expect(result.nextCalled).toBe(false);
    expect(result.status).toBe(401);
  });

  it('responds 403 for a valid session that is not content_lead', () => {
    const result = run(requestWithHeader(`Bearer ${tokenFor(1, 'moderator')}`));
    expect(result.nextCalled).toBe(false);
    expect(result.status).toBe(403);
  });
});

describe('parsePositiveInteger', () => {
  it('accepts a positive integer string', () => {
    expect(parsePositiveInteger('42')).toBe(42);
  });

  it('rejects undefined, zero, negative and fractional values', () => {
    expect(parsePositiveInteger(undefined)).toBeNull();
    expect(parsePositiveInteger('0')).toBeNull();
    expect(parsePositiveInteger('-1')).toBeNull();
    expect(parsePositiveInteger('2.5')).toBeNull();
    expect(parsePositiveInteger('abc')).toBeNull();
  });
});
