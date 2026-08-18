import { describe, expect, it } from 'vitest';
import { parseCandidateToken, signCandidateToken } from './candidate-tokens';

const SECRET = 'test-secret-do-not-use-in-production';
const OTHER_SECRET = 'a-completely-different-secret';
const ISSUED_AT = new Date('2026-03-01T09:00:00.000Z');
const TTL_MINUTES = 60 * 24 * 30; // 30 days -- a candidate re-registers rarely, unlike a reviewer shift

function freshToken(overrides: { userId?: number } = {}) {
  return signCandidateToken({ userId: overrides.userId ?? 11 }, SECRET, ISSUED_AT, TTL_MINUTES);
}

describe('signCandidateToken / parseCandidateToken', () => {
  it('round-trips userId through a fresh token', () => {
    const token = freshToken({ userId: 42 });

    expect(parseCandidateToken(token, SECRET, ISSUED_AT).userId).toBe(42);
  });

  it('records issuedAt and the computed expiresAt in the payload', () => {
    const token = freshToken();

    const payload = parseCandidateToken(token, SECRET, ISSUED_AT);

    expect(payload.issuedAt).toBe(ISSUED_AT.toISOString());
    expect(payload.expiresAt).toBe(
      new Date(ISSUED_AT.getTime() + TTL_MINUTES * 60_000).toISOString(),
    );
  });

  it('accepts the token at any moment strictly before expiry', () => {
    const token = freshToken();
    const justBeforeExpiry = new Date(ISSUED_AT.getTime() + TTL_MINUTES * 60_000 - 1);

    expect(() => parseCandidateToken(token, SECRET, justBeforeExpiry)).not.toThrow();
  });

  it('throws once now reaches expiresAt exactly', () => {
    const token = freshToken();
    const exactlyAtExpiry = new Date(ISSUED_AT.getTime() + TTL_MINUTES * 60_000);

    expect(() => parseCandidateToken(token, SECRET, exactlyAtExpiry)).toThrow(/expired/i);
  });

  it('throws for a token presented after its expiry', () => {
    const token = freshToken();
    const wellAfterExpiry = new Date(ISSUED_AT.getTime() + (TTL_MINUTES + 60) * 60_000);

    expect(() => parseCandidateToken(token, SECRET, wellAfterExpiry)).toThrow(/expired/i);
  });

  it('throws when verified against a different secret than it was signed with', () => {
    const token = freshToken();

    expect(() => parseCandidateToken(token, OTHER_SECRET, ISSUED_AT)).toThrow(/signature/i);
  });

  it('throws when the payload segment is tampered with after signing', () => {
    const token = freshToken({ userId: 42 });
    const [payloadSegment, signatureSegment] = token.split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ userId: 1 })).toString('base64url');

    expect(payloadSegment).not.toBe(forgedPayload);
    expect(() =>
      parseCandidateToken(`${forgedPayload}.${signatureSegment}`, SECRET, ISSUED_AT),
    ).toThrow(/signature/i);
  });

  it('throws when the signature segment is tampered with', () => {
    const token = freshToken();
    const [payloadSegment] = token.split('.');

    expect(() =>
      parseCandidateToken(`${payloadSegment}.not-a-real-signature`, SECRET, ISSUED_AT),
    ).toThrow(/signature/i);
  });

  it('throws on a token missing the signature segment entirely', () => {
    const [payloadSegment] = freshToken().split('.');

    expect(() => parseCandidateToken(payloadSegment, SECRET, ISSUED_AT)).toThrow();
  });

  it('throws on a token with extra segments', () => {
    expect(() => parseCandidateToken(`${freshToken()}.extra`, SECRET, ISSUED_AT)).toThrow();
  });

  it('throws on a payload segment that is not valid base64url', () => {
    expect(() => parseCandidateToken('not-base64!!!.signature', SECRET, ISSUED_AT)).toThrow();
  });

  it('throws on a payload segment that decodes to invalid JSON', () => {
    const garbage = Buffer.from('not json').toString('base64url');

    expect(() => parseCandidateToken(`${garbage}.signature`, SECRET, ISSUED_AT)).toThrow();
  });

  it('throws on a payload missing required fields', () => {
    const incomplete = Buffer.from(JSON.stringify({})).toString('base64url');

    expect(() => parseCandidateToken(`${incomplete}.signature`, SECRET, ISSUED_AT)).toThrow();
  });

  it('throws on empty, non-string, and undefined tokens', () => {
    for (const bad of ['', undefined, null, 42, {}]) {
      expect(() => parseCandidateToken(bad, SECRET, ISSUED_AT)).toThrow();
    }
  });

  it('produces a different token for a different secret, given identical payload and clock', () => {
    const a = signCandidateToken({ userId: 11 }, SECRET, ISSUED_AT, TTL_MINUTES);
    const b = signCandidateToken({ userId: 11 }, OTHER_SECRET, ISSUED_AT, TTL_MINUTES);

    expect(a).not.toBe(b);
  });

  it('throws when issuedAt is not a valid Date', () => {
    expect(() =>
      signCandidateToken({ userId: 1 }, SECRET, new Date('nonsense'), TTL_MINUTES),
    ).toThrow();
  });

  it('throws on a non-positive ttlMinutes', () => {
    expect(() => signCandidateToken({ userId: 1 }, SECRET, ISSUED_AT, 0)).toThrow();
    expect(() => signCandidateToken({ userId: 1 }, SECRET, ISSUED_AT, -5)).toThrow();
  });
});
