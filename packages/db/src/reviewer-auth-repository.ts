import type { AuthenticateOutcome, ChangePasswordOutcome } from '@jamb/shared';
import { pool } from './client';
import { firstRow } from './first-row';
import { hashPassword, verifyPassword } from './password-hashing';
import { loadReviewer, ReviewerNotActiveError, withTransaction } from './review-queue-repository';

export type { AuthenticateOutcome };

interface CredentialRow {
  reviewer_id: number;
  user_id: number;
  password_hash: string | null;
  must_change_password: boolean;
}

/**
 * Verifies `identifier` (a `users.email` or `users.phone` value) and
 * `password` against the stored credential, returning the reviewer's
 * identity on success.
 *
 * `invalid_credentials` covers three cases identically and
 * indistinguishably to the caller: no user matches `identifier`, the
 * password is wrong, and the reviewer has no `password_hash` set at all.
 * Collapsing these three is deliberate — distinguishing "wrong password"
 * from "unknown identifier" lets an attacker enumerate accounts, and a
 * reviewer with no password set is not a account a legitimate caller
 * should be able to detect either.
 *
 * `not_active` is reported distinctly, unlike the three cases above: it
 * only fires after the password has already verified, so the caller
 * already holds valid credentials and is not learning anything they
 * could not otherwise prove. Reuses `loadReviewer`'s activation check
 * (7.8) rather than re-implementing it.
 */
export async function authenticateReviewer(
  identifier: string,
  password: string,
): Promise<AuthenticateOutcome> {
  const client = await pool.connect();
  try {
    const result = await client.query<CredentialRow>(
      `SELECT r.id AS reviewer_id, r.user_id, r.password_hash, r.must_change_password
         FROM reviewers r
         JOIN users u ON u.id = r.user_id
        WHERE u.email = $1 OR u.phone = $1`,
      [identifier],
    );

    const credential = result.rows[0];
    if (!credential || credential.password_hash === null) {
      return { ok: false, reason: 'invalid_credentials' };
    }

    if (!verifyPassword(password, credential.password_hash)) {
      return { ok: false, reason: 'invalid_credentials' };
    }

    try {
      const reviewer = await loadReviewer(client, credential.reviewer_id);
      return {
        ok: true,
        reviewerId: reviewer.reviewer_id,
        userId: reviewer.user_id,
        role: reviewer.role,
        mustChangePassword: credential.must_change_password,
      };
    } catch (error) {
      if (error instanceof ReviewerNotActiveError) {
        return { ok: false, reason: 'not_active', status: error.status };
      }
      throw error;
    }
  } finally {
    client.release();
  }
}

/**
 * Provisions a password for a reviewer. Not a self-service flow — there is
 * no signup or password-reset endpoint yet ("full account management...
 * later work") — this exists so a reviewer can be given a working
 * credential at all, by whoever administers the panel, until that later
 * work exists.
 */
export async function setReviewerPassword(reviewerId: number, password: string): Promise<void> {
  const hash = hashPassword(password);
  const client = await pool.connect();
  try {
    firstRow(
      await client.query<{ id: number }>(
        `UPDATE reviewers SET password_hash = $2 WHERE id = $1 RETURNING id`,
        [reviewerId, hash],
      ),
    );
  } finally {
    client.release();
  }
}

/**
 * A reviewer replacing their own password — the forced first-login change
 * after a content lead issued a temporary one, or any later voluntary
 * change. Requires the current password even though the caller is already
 * authenticated: a bearer token left on a shared phone must not be enough
 * to lock the real reviewer out of their account.
 *
 * Goes through `loadReviewer`, so a suspended or removed reviewer whose
 * token has not yet expired gets `ReviewerNotActiveError` (a 401 via
 * `app.ts`, which also signs the admin client out) rather than a
 * password change.
 */
export async function changeOwnPassword(
  reviewerId: number,
  currentPassword: string,
  newPassword: string,
): Promise<ChangePasswordOutcome> {
  return withTransaction(async (client) => {
    await loadReviewer(client, reviewerId);

    const { password_hash: storedHash } = firstRow(
      await client.query<{ password_hash: string | null }>(
        `SELECT password_hash FROM reviewers WHERE id = $1 FOR UPDATE`,
        [reviewerId],
      ),
    );

    if (storedHash === null || !verifyPassword(currentPassword, storedHash)) {
      return { ok: false, reason: 'wrong_current_password' };
    }

    await client.query(
      `UPDATE reviewers SET password_hash = $2, must_change_password = false WHERE id = $1`,
      [reviewerId, hashPassword(newPassword)],
    );

    return { ok: true };
  });
}
