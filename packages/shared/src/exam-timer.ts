/**
 * The mock-exam timer (plan 3, canonical session 12) — pure, no clock of its
 * own. Every function takes whatever `Date`s it needs as arguments, the same
 * discipline `item-state-machine.ts`'s `occurredAt` already established.
 *
 * DESIGN: remaining time is always derived from an absolute end timestamp
 * (`endAt`), never stored as a decrementing countdown — nothing about a
 * countdown value is ever persisted to roll back, which is what makes
 * "kill the app to pause the clock" impossible by construction.
 *
 * `computeEffectiveNow` is the guard against a device clock wound backward:
 * it ratchets forward only, so a clock rolled back can never produce an
 * effective-now earlier than one already observed. See
 * `packages/shared/README.md` for the full reasoning.
 */

function assertValidDate(value: Date, fieldName: string, callerName: string): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`${callerName}: ${fieldName} must be a valid Date`);
  }
}

export function computeSessionEndAt(startedAt: Date, totalDurationMinutes: number): Date {
  assertValidDate(startedAt, 'startedAt', 'computeSessionEndAt');
  if (!Number.isFinite(totalDurationMinutes) || totalDurationMinutes <= 0) {
    throw new Error(
      `computeSessionEndAt: totalDurationMinutes must be a positive number, got ${totalDurationMinutes}`,
    );
  }
  return new Date(startedAt.getTime() + totalDurationMinutes * 60_000);
}

/**
 * `max(actualNow, lastObservedAt)` — the monotonic ratchet. A legitimate
 * forward clock correction just costs the candidate a little perceived
 * time, which is the safe direction to err.
 */
export function computeEffectiveNow(actualNow: Date, lastObservedAt: Date): Date {
  assertValidDate(actualNow, 'actualNow', 'computeEffectiveNow');
  assertValidDate(lastObservedAt, 'lastObservedAt', 'computeEffectiveNow');
  return actualNow.getTime() >= lastObservedAt.getTime() ? actualNow : lastObservedAt;
}

/** Whole seconds remaining, floored at zero rather than going negative once expired. */
export function computeRemainingSeconds(endAt: Date, effectiveNow: Date): number {
  assertValidDate(endAt, 'endAt', 'computeRemainingSeconds');
  assertValidDate(effectiveNow, 'effectiveNow', 'computeRemainingSeconds');
  const remainingMs = endAt.getTime() - effectiveNow.getTime();
  return Math.max(0, Math.floor(remainingMs / 1000));
}

export function hasExpired(endAt: Date, effectiveNow: Date): boolean {
  assertValidDate(endAt, 'endAt', 'hasExpired');
  assertValidDate(effectiveNow, 'effectiveNow', 'hasExpired');
  return effectiveNow.getTime() >= endAt.getTime();
}
