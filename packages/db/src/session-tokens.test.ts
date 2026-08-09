import { describe, expect, it } from 'vitest';
import { PANEL_ROLES } from '@jamb/shared';
import { parseSessionToken, signSessionToken } from './session-tokens';

const SECRET = 'test-secret-do-not-use-in-production';
const OTHER_SECRET = 'a-completely-different-secret';
const ISSUED_AT = new Date('2026-03-01T09:00:00.000Z');
const TTL_MINUTES = 480; // 8 hours

function freshToken(overrides: { reviewerId?: number; role?: 'reviewer' | 'moderator' } = {}) {
  return signSessionToken(
    { reviewerId: overrides.reviewerId ?? 11, role: overrides.role ?? 'reviewer' },
    SECRET,
    ISSUED_AT,
    TTL_MINUTES,
  );
}

describe('signSessionToken / parseSessionToken', () => {
  it('round-trips reviewerId and role through a fresh token', () => {
    const token = freshToken({ reviewerId: 42, role: 'moderator' });

    const payload = parseSessionToken(token, SECRET, ISSUED_AT);

    expect(payload.reviewerId).toBe(42);
    expect(payload.role).toBe('moderator');
  });

  it.each(PANEL_ROLES)('round-trips every panel role, including %s', (role) => {
    const token = freshToken({ role: role as 'reviewer' | 'moderator' });

    expect(parseSessionToken(token, SECRET, ISSUED_AT).role).toBe(role);
  });

  it('records issuedAt and the computed expiresAt in the payload', () => {
    const token = freshToken();

    const payload = parseSessionToken(token, SECRET, ISSUED_AT);

    expect(payload.issuedAt).toBe(ISSUED_AT.toISOString());
    expect(payload.expiresAt).toBe(
      new Date(ISSUED_AT.getTime() + TTL_MINUTES * 60_000).toISOString(),
    );
  });

  it('accepts the token at any moment strictly before expiry', () => {
    const token = freshToken();
    const justBeforeExpiry = new Date(ISSUED_AT.getTime() + TTL_MINUTES * 60_000 - 1);

    expect(() => parseSessionToken(token, SECRET, justBeforeExpiry)).not.toThrow();
  });

  it('throws once now reaches expiresAt exactly', () => {
    // Exclusive expiry: a token is not valid "through" its expiry instant.
    const token = freshToken();
    const exactlyAtExpiry = new Date(ISSUED_AT.getTime() + TTL_MINUTES * 60_000);

    expect(() => parseSessionToken(token, SECRET, exactlyAtExpiry)).toThrow(/expired/i);
  });

  it('throws for a token presented after its expiry', () => {
    const token = freshToken();
    const wellAfterExpiry = new Date(ISSUED_AT.getTime() + (TTL_MINUTES + 60) * 60_000);

    expect(() => parseSessionToken(token, SECRET, wellAfterExpiry)).toThrow(/expired/i);
  });

  it('throws when verified against a different secret than it was signed with', () => {
    const token = freshToken();

    expect(() => parseSessionToken(token, OTHER_SECRET, ISSUED_AT)).toThrow(/signature/i);
  });

  it('throws when the payload segment is tampered with after signing', () => {
    // A forged reviewerId=1 (superuser-shaped guess) must not verify just
    // because the attacker controls the payload segment — the signature
    // covers it.
    const token = freshToken({ reviewerId: 42 });
    const [payloadSegment, signatureSegment] = token.split('.');
    const forgedPayload = Buffer.from(
      JSON.stringify({ reviewerId: 1, role: 'moderator' }),
    ).toString('base64url');

    expect(payloadSegment).not.toBe(forgedPayload);
    expect(() =>
      parseSessionToken(`${forgedPayload}.${signatureSegment}`, SECRET, ISSUED_AT),
    ).toThrow(/signature/i);
  });

  it('throws when the signature segment is tampered with', () => {
    const token = freshToken();
    const [payloadSegment] = token.split('.');

    expect(() =>
      parseSessionToken(`${payloadSegment}.not-a-real-signature`, SECRET, ISSUED_AT),
    ).toThrow(/signature/i);
  });

  it('throws on a token missing the signature segment entirely', () => {
    const [payloadSegment] = freshToken().split('.');

    expect(() => parseSessionToken(payloadSegment, SECRET, ISSUED_AT)).toThrow();
  });

  it('throws on a token with extra segments', () => {
    expect(() => parseSessionToken(`${freshToken()}.extra`, SECRET, ISSUED_AT)).toThrow();
  });

  it('throws on a payload segment that is not valid base64url', () => {
    expect(() => parseSessionToken('not-base64!!!.signature', SECRET, ISSUED_AT)).toThrow();
  });

  it('throws on a payload segment that decodes to invalid JSON', () => {
    const garbage = Buffer.from('not json').toString('base64url');

    expect(() => parseSessionToken(`${garbage}.signature`, SECRET, ISSUED_AT)).toThrow();
  });

  it('throws on a payload missing required fields', () => {
    const incomplete = Buffer.from(JSON.stringify({ reviewerId: 1 })).toString('base64url');

    expect(() => parseSessionToken(`${incomplete}.signature`, SECRET, ISSUED_AT)).toThrow();
  });

  it('throws on a payload whose role is not a recognised panel role', () => {
    const token = signSessionToken(
      // @ts-expect-error deliberately invalid role to prove runtime validation
      { reviewerId: 1, role: 'superadmin' },
      SECRET,
      ISSUED_AT,
      TTL_MINUTES,
    );

    expect(() => parseSessionToken(token, SECRET, ISSUED_AT)).toThrow(/role/i);
  });

  it('throws on empty, non-string, and undefined tokens', () => {
    for (const bad of ['', undefined, null, 42, {}]) {
      expect(() => parseSessionToken(bad, SECRET, ISSUED_AT)).toThrow();
    }
  });

  it('produces a different token for a different secret, given identical payload and clock', () => {
    const a = signSessionToken(
      { reviewerId: 11, role: 'reviewer' },
      SECRET,
      ISSUED_AT,
      TTL_MINUTES,
    );
    const b = signSessionToken(
      { reviewerId: 11, role: 'reviewer' },
      OTHER_SECRET,
      ISSUED_AT,
      TTL_MINUTES,
    );

    expect(a).not.toBe(b);
  });

  it('throws when issuedAt is not a valid Date', () => {
    expect(() =>
      signSessionToken(
        { reviewerId: 1, role: 'reviewer' },
        SECRET,
        new Date('nonsense'),
        TTL_MINUTES,
      ),
    ).toThrow();
  });

  it('throws on a non-positive ttlMinutes', () => {
    expect(() =>
      signSessionToken({ reviewerId: 1, role: 'reviewer' }, SECRET, ISSUED_AT, 0),
    ).toThrow();
    expect(() =>
      signSessionToken({ reviewerId: 1, role: 'reviewer' }, SECRET, ISSUED_AT, -5),
    ).toThrow();
  });
});
