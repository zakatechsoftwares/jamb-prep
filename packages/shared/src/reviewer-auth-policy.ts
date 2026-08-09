import type { PanelRole } from './item-lifecycle';

/**
 * The outcome of verifying a reviewer's credentials, declared here and
 * implemented in `@jamb/db/reviewer-auth-repository.ts` — the same split as
 * `ReviewDecisionService` and friends: the shape lives in one place so
 * `apps/api`'s login route can be wired against it without importing the
 * database at module load.
 *
 * `invalid_credentials` covers three cases identically: no user matches the
 * identifier, the password is wrong, and the reviewer has no password set
 * at all. `not_active` is reported distinctly — it only fires once the
 * password has already verified, so the caller already holds valid
 * credentials and is not learning anything they could not otherwise prove.
 */
export type AuthenticateOutcome =
  | { ok: true; reviewerId: number; userId: number; role: PanelRole }
  | { ok: false; reason: 'invalid_credentials' }
  | { ok: false; reason: 'not_active'; status: string };

/** What `apps/api`'s login route needs from the review workflow. */
export interface AuthService {
  login(emailOrPhone: string, password: string): Promise<AuthenticateOutcome>;
}

export interface LoginInput {
  emailOrPhone: string;
  password: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The `POST /review/login` boundary validator. `password` is never echoed
 * into a thrown message — unlike a malformed `emailOrPhone`, which is not a
 * credential, a malformed password value must not end up readable in a log
 * line just because the request that carried it was rejected.
 */
export function parseLoginInput(raw: unknown): LoginInput {
  if (!isPlainObject(raw)) {
    throw new Error(`login input must be an object, got ${JSON.stringify(raw)}`);
  }

  if (typeof raw.emailOrPhone !== 'string' || raw.emailOrPhone.trim().length === 0) {
    throw new Error(
      `emailOrPhone must be a non-empty string, got ${JSON.stringify(raw.emailOrPhone)}`,
    );
  }

  if (typeof raw.password !== 'string' || raw.password.length === 0) {
    throw new Error('password must be a non-empty string');
  }

  return { emailOrPhone: raw.emailOrPhone.trim(), password: raw.password };
}
