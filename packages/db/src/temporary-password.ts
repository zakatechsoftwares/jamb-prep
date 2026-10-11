import { randomInt } from 'node:crypto';

/**
 * No 0/O, 1/l/I: a temporary password is read off a screen by a content
 * lead and retyped by a reviewer on a phone, often after being relayed by
 * message, so visually ambiguous characters are the main way it goes wrong.
 */
export const TEMPORARY_PASSWORD_ALPHABET =
  'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

export const TEMPORARY_PASSWORD_LENGTH = 12;

/**
 * A one-time password for a newly created or reset panel account. The
 * index picker is injected (CLAUDE.md: never reach for randomness inside a
 * decision) so a test can pin the output; the default is Node's
 * cryptographically secure `randomInt`, which a real caller must keep —
 * unlike `generateSyncId`, this value *is* a credential.
 */
export function generateTemporaryPassword(
  pickIndex: (maxExclusive: number) => number = randomInt,
): string {
  const size = TEMPORARY_PASSWORD_ALPHABET.length;
  let password = '';

  for (let position = 0; position < TEMPORARY_PASSWORD_LENGTH; position += 1) {
    const index = pickIndex(size);
    if (!Number.isInteger(index) || index < 0 || index >= size) {
      throw new Error(
        `generateTemporaryPassword: pickIndex must return an integer in [0, ${size}), got ${index}`,
      );
    }
    password += TEMPORARY_PASSWORD_ALPHABET[index];
  }

  return password;
}
