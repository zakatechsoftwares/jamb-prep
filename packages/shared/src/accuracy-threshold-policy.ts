/**
 * Reviewer accuracy thresholds (plan 7.11), versioned like
 * `review_queue_configs`. `thresholdRate` is a fraction in `[0, 1]`, never a
 * percentage — the plan's "the threshold" mapped the same way every rate in
 * this codebase is.
 */
export interface AccuracyThresholdConfig {
  thresholdRate: number;
  /**
   * How many *consecutive* below-threshold checks constitute "sustained
   * failure" (deactivation) rather than a single dip (recalibration).
   */
  sustainedFailureCount: number;
}

export type AccuracyThresholdOutcome =
  | { verdict: 'ok'; consecutiveFailures: 0 }
  | { verdict: 'recalibrate'; consecutiveFailures: number }
  | { verdict: 'deactivate'; consecutiveFailures: number };

function assertUnitInterval(value: number, fieldName: string): void {
  if (typeof value !== 'number' || Number.isNaN(value) || value < 0 || value > 1) {
    throw new Error(`evaluateAccuracyThreshold: ${fieldName} must be in [0, 1], got ${value}`);
  }
}

function assertNonNegativeInteger(value: number, fieldName: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      `evaluateAccuracyThreshold: ${fieldName} must be a non-negative whole number, got ${value}`,
    );
  }
}

/**
 * One reviewer's accuracy check against the threshold (plan 7.11): "falling
 * below the threshold triggers targeted re-calibration; sustained failure
 * removes the reviewer from the panel". A single dip recalibrates; the
 * streak has to reach `sustainedFailureCount` consecutive failures before
 * it escalates to deactivation. Any check at or above threshold resets the
 * streak to zero — sustained means consecutive, not cumulative.
 *
 * Pure: the caller reads `accuracyScore` and the reviewer's currently
 * stored streak, and persists whatever `consecutiveFailures` this returns
 * — this function never touches the database or a clock itself.
 */
export function evaluateAccuracyThreshold(
  config: AccuracyThresholdConfig,
  accuracyScore: number,
  priorConsecutiveFailures: number,
): AccuracyThresholdOutcome {
  assertUnitInterval(config.thresholdRate, 'thresholdRate');
  if (!Number.isInteger(config.sustainedFailureCount) || config.sustainedFailureCount < 1) {
    throw new Error(
      `evaluateAccuracyThreshold: sustainedFailureCount must be a positive whole number, got ${config.sustainedFailureCount}`,
    );
  }
  assertUnitInterval(accuracyScore, 'accuracyScore');
  assertNonNegativeInteger(priorConsecutiveFailures, 'priorConsecutiveFailures');

  if (accuracyScore >= config.thresholdRate) {
    return { verdict: 'ok', consecutiveFailures: 0 };
  }

  const consecutiveFailures = priorConsecutiveFailures + 1;
  return {
    verdict: consecutiveFailures >= config.sustainedFailureCount ? 'deactivate' : 'recalibrate',
    consecutiveFailures,
  };
}
