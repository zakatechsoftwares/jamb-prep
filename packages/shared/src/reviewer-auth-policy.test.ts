import { describe, expect, it } from 'vitest';
import { parseLoginInput } from './reviewer-auth-policy';

describe('parseLoginInput', () => {
  it('parses a well-formed login body', () => {
    expect(parseLoginInput({ emailOrPhone: 'reviewer@example.test', password: 'hunter2' })).toEqual(
      {
        emailOrPhone: 'reviewer@example.test',
        password: 'hunter2',
      },
    );
  });

  it('parses a phone identifier the same way', () => {
    expect(parseLoginInput({ emailOrPhone: '+2348012345678', password: 'hunter2' })).toEqual({
      emailOrPhone: '+2348012345678',
      password: 'hunter2',
    });
  });

  it('trims surrounding whitespace from emailOrPhone but not from password', () => {
    expect(
      parseLoginInput({ emailOrPhone: '  reviewer@example.test  ', password: ' hunter2 ' }),
    ).toEqual({ emailOrPhone: 'reviewer@example.test', password: ' hunter2 ' });
  });

  it('throws when the raw input is not an object', () => {
    for (const bad of ['reviewer@example.test', 42, null, undefined, [], true]) {
      expect(() => parseLoginInput(bad)).toThrow();
    }
  });

  it('throws when emailOrPhone is missing, empty, or not a string', () => {
    expect(() => parseLoginInput({ password: 'hunter2' })).toThrow(/emailOrPhone/i);
    expect(() => parseLoginInput({ emailOrPhone: '', password: 'hunter2' })).toThrow(
      /emailOrPhone/i,
    );
    expect(() => parseLoginInput({ emailOrPhone: '   ', password: 'hunter2' })).toThrow(
      /emailOrPhone/i,
    );
    expect(() => parseLoginInput({ emailOrPhone: 42, password: 'hunter2' })).toThrow(
      /emailOrPhone/i,
    );
  });

  it('throws when password is missing, empty, or not a string', () => {
    expect(() => parseLoginInput({ emailOrPhone: 'reviewer@example.test' })).toThrow(/password/i);
    expect(() => parseLoginInput({ emailOrPhone: 'reviewer@example.test', password: '' })).toThrow(
      /password/i,
    );
    expect(() => parseLoginInput({ emailOrPhone: 'reviewer@example.test', password: 42 })).toThrow(
      /password/i,
    );
  });

  it('never echoes the password value into a thrown error message', () => {
    // A malformed-password error is still a log line somewhere; the actual
    // password must never appear inside it.
    const secret = 'super-secret-value-should-not-leak';
    try {
      parseLoginInput({
        emailOrPhone: 'reviewer@example.test',
        password: ['not-a-string', secret],
      });
      expect.unreachable();
    } catch (error) {
      expect(error instanceof Error ? error.message : String(error)).not.toContain(secret);
    }
  });
});
