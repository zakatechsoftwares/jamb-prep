import type { Pool, PoolClient } from 'pg';
import { pool } from './client';
import { firstRow } from './first-row';

/**
 * Candidate identity (progress sync, plan 8.3) — a candidate is a `users`
 * row directly, never a role table pointed at one the way a reviewer is.
 * There is no password/OTP step here by deliberate choice: a device
 * registers once with the profile fields `users` already requires, and
 * gets back a long-lived token (`candidate-tokens.ts`) tied to the
 * resulting `users.id`. Proportionate for an internal/beta phase, not a
 * public-launch auth story — real signup/payments/entitlements remain
 * their own later session.
 */
export interface CandidateRegistrationDraft {
  fullName: string;
  phone: string;
  examYear: number;
}

/**
 * Idempotent on `phone`, the same conflict-then-lookup pattern
 * `startSession`/`recordAttempt` already use for their own unique keys —
 * registering twice from the same phone number returns the same
 * `users.id` rather than erroring or creating a duplicate account.
 */
export async function findOrCreateCandidate(
  input: CandidateRegistrationDraft,
  client?: PoolClient,
): Promise<{ userId: number }> {
  const runner: Pool | PoolClient = client ?? pool;

  const inserted = await runner.query<{ id: number }>(
    `INSERT INTO users (full_name, phone, exam_year)
     VALUES ($1, $2, $3)
     ON CONFLICT (phone) DO NOTHING
     RETURNING id`,
    [input.fullName, input.phone, input.examYear],
  );
  if ((inserted.rowCount ?? 0) > 0) {
    return { userId: firstRow(inserted).id };
  }

  return {
    userId: firstRow(
      await runner.query<{ id: number }>(`SELECT id FROM users WHERE phone = $1`, [input.phone]),
    ).id,
  };
}
