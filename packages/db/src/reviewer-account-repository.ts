import { DatabaseError, type PoolClient } from 'pg';
import {
  isManageableAccount,
  type CreateReviewerAccountInput,
  type CreateReviewerAccountOutcome,
  type ManageableReviewerStatus,
  type PanelRole,
  type ResetReviewerPasswordOutcome,
  type ReviewerAccountSummary,
  type ReviewerStatus,
  type SetReviewerStatusOutcome,
  type SubjectSummary,
} from '@jamb/shared';
import { pool } from './client';
import { firstRow } from './first-row';
import { hashPassword } from './password-hashing';
import { withTransaction } from './review-queue-repository';
import { generateTemporaryPassword } from './temporary-password';

/**
 * Content-lead management of panel accounts (plan 7.8: the content lead
 * recruits the panel). The hand-provisioned replacement for creating
 * `users`/`reviewers`/`reviewer_subjects` rows directly in the database and
 * calling `setReviewerPassword` by hand.
 *
 * Every temporary password is hashed before it is stored and returned to
 * the caller exactly once; `must_change_password` forces the reviewer to
 * replace it on their next login.
 */

type GeneratePassword = () => string;

interface AccountRow {
  reviewer_id: number;
  full_name: string;
  phone: string;
  email: string | null;
  role: PanelRole;
  status: ReviewerStatus;
  must_change_password: boolean;
  created_at: Date;
  subjects: SubjectSummary[];
}

export async function listReviewerAccounts(): Promise<ReviewerAccountSummary[]> {
  const result = await pool.query<AccountRow>(
    `SELECT r.id AS reviewer_id, u.full_name, u.phone, u.email, r.role, r.status,
            r.must_change_password, r.created_at,
            COALESCE(
              json_agg(json_build_object('id', s.id, 'name', s.name) ORDER BY s.name)
                FILTER (WHERE s.id IS NOT NULL),
              '[]'
            ) AS subjects
       FROM reviewers r
       JOIN users u ON u.id = r.user_id
       LEFT JOIN reviewer_subjects rs ON rs.reviewer_id = r.id
       LEFT JOIN subjects s ON s.id = rs.subject_id
      GROUP BY r.id, u.id
      ORDER BY u.full_name, r.id`,
  );

  return result.rows.map((row) => ({
    reviewerId: row.reviewer_id,
    fullName: row.full_name,
    phone: row.phone,
    email: row.email,
    role: row.role,
    status: row.status,
    // json_agg bypasses the int8 type parser in client.ts — ids inside the
    // JSON are already JSON numbers, which is what SubjectSummary declares.
    subjects: row.subjects,
    mustChangePassword: row.must_change_password,
    createdAt: row.created_at.toISOString(),
  }));
}

export async function listSubjects(): Promise<SubjectSummary[]> {
  const result = await pool.query<SubjectSummary>(`SELECT id, name FROM subjects ORDER BY name`);
  return result.rows;
}

/**
 * Maps the constraint a failed insert hit onto the outcome the content lead
 * sees. Relies on the database's own unique/foreign-key constraints rather
 * than a check-then-insert, so two content leads creating the same phone
 * number at once still get a clean `phone_taken` for whichever loses.
 */
function outcomeForConstraint(error: unknown): CreateReviewerAccountOutcome | null {
  if (!(error instanceof DatabaseError)) {
    return null;
  }
  switch (error.constraint) {
    case 'users_phone_key':
      return { ok: false, reason: 'phone_taken' };
    case 'users_email_key':
      return { ok: false, reason: 'email_taken' };
    case 'reviewer_subjects_subject_id_fkey':
      return { ok: false, reason: 'unknown_subject' };
    default:
      return null;
  }
}

/**
 * Creates a `users` row, an `active` `reviewers` row and its
 * `reviewer_subjects`, all in one transaction. A phone or email that
 * already belongs to any user — a candidate included — is rejected rather
 * than attached to: a mistyped number must never hand reviewer access to a
 * stranger's account.
 *
 * `users.exam_year` is NOT NULL because the table was designed for
 * candidates; a panel member is not sitting an exam, so it is filled with
 * the year the account was created, matching how every existing reviewer
 * row was provisioned. Nothing reads it for a reviewer.
 */
export async function createReviewerAccount(
  input: CreateReviewerAccountInput,
  createdAt: Date,
  generatePassword: GeneratePassword = generateTemporaryPassword,
): Promise<CreateReviewerAccountOutcome> {
  const temporaryPassword = generatePassword();

  try {
    const reviewerId = await withTransaction(async (client) => {
      const userId = firstRow(
        await client.query<{ id: number }>(
          `INSERT INTO users (full_name, phone, email, exam_year)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [input.fullName, input.phone, input.email, createdAt.getUTCFullYear()],
        ),
      ).id;

      const id = firstRow(
        await client.query<{ id: number }>(
          `INSERT INTO reviewers (user_id, role, status, activated_at, password_hash, must_change_password)
           VALUES ($1, $2, 'active', $3, $4, true) RETURNING id`,
          [userId, input.role, createdAt, hashPassword(temporaryPassword)],
        ),
      ).id;

      for (const subjectId of input.subjectIds) {
        await client.query(
          `INSERT INTO reviewer_subjects (reviewer_id, subject_id) VALUES ($1, $2)`,
          [id, subjectId],
        );
      }

      return id;
    });

    return { ok: true, reviewerId, temporaryPassword };
  } catch (error) {
    const outcome = outcomeForConstraint(error);
    if (outcome) {
      return outcome;
    }
    throw error;
  }
}

/**
 * Locks the account row and checks it may be managed by a content lead.
 * Returns the failure outcome, or null when the caller may proceed.
 */
async function lockManageableAccount(
  client: PoolClient,
  reviewerId: number,
): Promise<{ ok: false; reason: 'not_found' | 'not_manageable' } | null> {
  const result = await client.query<{ role: string; status: string }>(
    `SELECT role, status FROM reviewers WHERE id = $1 FOR UPDATE`,
    [reviewerId],
  );
  const account = result.rows[0];

  if (!account) {
    return { ok: false, reason: 'not_found' };
  }
  if (!isManageableAccount(account)) {
    return { ok: false, reason: 'not_manageable' };
  }
  return null;
}

/**
 * Issues a fresh temporary password, for a reviewer who has forgotten
 * theirs. Sessions already signed for the account are not revoked — they
 * expire on their own within the session TTL; suspension is the immediate
 * lever, since `status` is rechecked on every request.
 */
export async function resetReviewerPassword(
  reviewerId: number,
  generatePassword: GeneratePassword = generateTemporaryPassword,
): Promise<ResetReviewerPasswordOutcome> {
  return withTransaction(async (client) => {
    const refused = await lockManageableAccount(client, reviewerId);
    if (refused) {
      return refused;
    }

    const temporaryPassword = generatePassword();
    await client.query(
      `UPDATE reviewers SET password_hash = $2, must_change_password = true WHERE id = $1`,
      [reviewerId, hashPassword(temporaryPassword)],
    );

    return { ok: true, temporaryPassword };
  });
}

export async function setReviewerStatus(
  reviewerId: number,
  status: ManageableReviewerStatus,
): Promise<SetReviewerStatusOutcome> {
  return withTransaction(async (client) => {
    const refused = await lockManageableAccount(client, reviewerId);
    if (refused) {
      return refused;
    }

    await client.query(`UPDATE reviewers SET status = $2 WHERE id = $1`, [reviewerId, status]);
    return { ok: true };
  });
}
