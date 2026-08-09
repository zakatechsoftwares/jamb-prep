import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password-hashing';

describe('hashPassword / verifyPassword', () => {
  it('verifies the correct password against its own hash', () => {
    const hash = hashPassword('correct horse battery staple');

    expect(verifyPassword('correct horse battery staple', hash)).toBe(true);
  });

  it('rejects a wrong password', () => {
    const hash = hashPassword('correct horse battery staple');

    expect(verifyPassword('wrong password', hash)).toBe(false);
  });

  it('rejects a password differing only in case', () => {
    const hash = hashPassword('CaseSensitive1');

    expect(verifyPassword('casesensitive1', hash)).toBe(false);
  });

  it('produces a different hash for the same password each time (random salt)', () => {
    const first = hashPassword('correct horse battery staple');
    const second = hashPassword('correct horse battery staple');

    expect(first).not.toBe(second);
    expect(verifyPassword('correct horse battery staple', first)).toBe(true);
    expect(verifyPassword('correct horse battery staple', second)).toBe(true);
  });

  it('returns false, rather than throwing, for a malformed stored hash', () => {
    // A defensive boundary: whatever is sitting in reviewers.password_hash
    // came from the database, but "verify against garbage" must still be
    // an ordinary false rather than a 500.
    expect(verifyPassword('anything', 'not-a-real-hash')).toBe(false);
    expect(verifyPassword('anything', '')).toBe(false);
    expect(verifyPassword('anything', 'scrypt$only-one-field')).toBe(false);
  });

  it('throws on an empty password at hash time', () => {
    expect(() => hashPassword('')).toThrow();
  });
});
