/**
 * Whether a candidate may sign out of the mobile app on this device.
 *
 * Local sessions and attempts carry no candidate id: `syncPendingSessions`
 * uploads every not-yet-synced session under whoever is registered at that
 * moment. Signing out with work still waiting would let the next candidate
 * on the device upload it as their own, and the server would accept it.
 * Rules 2 and 3 forbid the admin app's answer (warn, then discard): attempts
 * are never deleted and no submitted attempt may be lost. So sign-out waits
 * until that work has uploaded (confirmed with the user: block, not discard).
 *
 * Sessions under the demo exam config are ignored. They reference fixture
 * items and a sentinel config the server always rejects, so they can never
 * upload under any account and so can never be credited to the wrong one.
 * Counting them would lock out everyone who has ever tried the demo mock.
 */

export interface CandidateSignOutInput {
  /** A mock session on this device has started and not yet ended. */
  hasOpenMockSession: boolean;
  /** The exam config id of every ended session not yet synced. */
  unsyncedSessionExamConfigIds: readonly number[];
  /** The exam config id whose sessions can never sync (the demo sentinel). */
  unsyncableExamConfigId: number;
}

export type CandidateSignOutDecision =
  | { canSignOut: true }
  | { canSignOut: false; reason: 'mock_in_progress' }
  | { canSignOut: false; reason: 'unsynced_sessions'; unsyncedCount: number };

function assertExamConfigId(value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      `decideCandidateSignOut: exam config id must be a non-negative integer, got ${value}`,
    );
  }
}

export function decideCandidateSignOut(input: CandidateSignOutInput): CandidateSignOutDecision {
  assertExamConfigId(input.unsyncableExamConfigId);
  for (const examConfigId of input.unsyncedSessionExamConfigIds) {
    assertExamConfigId(examConfigId);
  }

  // Finishing the mock comes first: an open session can't upload until it ends.
  if (input.hasOpenMockSession) {
    return { canSignOut: false, reason: 'mock_in_progress' };
  }

  const unsyncedCount = input.unsyncedSessionExamConfigIds.filter(
    (examConfigId) => examConfigId !== input.unsyncableExamConfigId,
  ).length;
  if (unsyncedCount > 0) {
    return { canSignOut: false, reason: 'unsynced_sessions', unsyncedCount };
  }

  return { canSignOut: true };
}
