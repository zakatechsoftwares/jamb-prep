/**
 * Coverage-gap detection for the contributor brief board (plan 7.12 step 1)
 * — pure comparison, no I/O. `packages/db` supplies each objective's live
 * approved-item count and its content-lead-set target; this function only
 * decides which objectives fall short and by how much.
 */
export interface ObjectiveCoverage {
  objectiveId: number;
  approvedCount: number;
  /** Set by the content lead per objective; callers only pass objectives that have one. */
  targetItemCount: number;
  /** Whether generation cannot fill this objective at all (diagram-dependent, reading text, policy/current-affairs). Carried through unchanged, not used in the comparison itself. */
  requiresHumanAuthorship: boolean;
}

export interface CoverageGap {
  objectiveId: number;
  deficit: number;
  requiresHumanAuthorship: boolean;
}

function assertNonNegativeInteger(value: number, fieldName: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`detectCoverageGaps: ${fieldName} must be a non-negative whole number, got ${value}`);
  }
}

function assertPositiveInteger(value: number, fieldName: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`detectCoverageGaps: ${fieldName} must be a positive whole number, got ${value}`);
  }
}

/**
 * Which objectives fall short of their target, sorted largest deficit
 * first — that ordering is what makes the content lead's "what needs a
 * brief most urgently" question answerable directly from this list, not a
 * side effect of insertion order.
 */
export function detectCoverageGaps(coverage: ObjectiveCoverage[]): CoverageGap[] {
  for (const entry of coverage) {
    assertPositiveInteger(entry.objectiveId, 'objectiveId');
    assertNonNegativeInteger(entry.approvedCount, 'approvedCount');
    assertPositiveInteger(entry.targetItemCount, 'targetItemCount');
  }

  return coverage
    .filter((entry) => entry.approvedCount < entry.targetItemCount)
    .map((entry) => ({
      objectiveId: entry.objectiveId,
      deficit: entry.targetItemCount - entry.approvedCount,
      requiresHumanAuthorship: entry.requiresHumanAuthorship,
    }))
    .sort((a, b) => b.deficit - a.deficit);
}
