import { describe, expect, it } from 'vitest';
import { MIN_PASSWORD_LENGTH } from '@jamb/shared';
import {
  TEMPORARY_PASSWORD_ALPHABET,
  TEMPORARY_PASSWORD_LENGTH,
  generateTemporaryPassword,
} from './temporary-password';

describe('generateTemporaryPassword', () => {
  it('is deterministic for a pinned index picker', () => {
    let next = 0;
    const password = generateTemporaryPassword(() => next++);
    expect(password).toBe(TEMPORARY_PASSWORD_ALPHABET.slice(0, TEMPORARY_PASSWORD_LENGTH));
  });

  it('asks the picker for indices over the whole alphabet', () => {
    const asked: number[] = [];
    generateTemporaryPassword((max) => {
      asked.push(max);
      return 0;
    });
    expect(asked).toEqual(
      Array.from({ length: TEMPORARY_PASSWORD_LENGTH }, () => TEMPORARY_PASSWORD_ALPHABET.length),
    );
  });

  it('meets the minimum new-password length, so it is never weaker than a chosen one', () => {
    expect(TEMPORARY_PASSWORD_LENGTH).toBeGreaterThanOrEqual(MIN_PASSWORD_LENGTH);
  });

  it('contains no visually ambiguous characters', () => {
    for (const ambiguous of ['0', 'O', '1', 'l', 'I']) {
      expect(TEMPORARY_PASSWORD_ALPHABET).not.toContain(ambiguous);
    }
  });

  it('uses only alphabet characters with the real random source', () => {
    for (let run = 0; run < 50; run += 1) {
      const password = generateTemporaryPassword();
      expect(password).toHaveLength(TEMPORARY_PASSWORD_LENGTH);
      for (const character of password) {
        expect(TEMPORARY_PASSWORD_ALPHABET).toContain(character);
      }
    }
  });

  it('throws when the picker returns something outside the alphabet', () => {
    const size = TEMPORARY_PASSWORD_ALPHABET.length;
    for (const bad of [-1, size, 1.5, Number.NaN]) {
      expect(() => generateTemporaryPassword(() => bad)).toThrow(/pickIndex/);
    }
  });
});
