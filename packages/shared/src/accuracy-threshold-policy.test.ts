import { describe, expect, it } from 'vitest';
import {
  evaluateAccuracyThreshold,
  type AccuracyThresholdConfig,
} from './accuracy-threshold-policy';

const CONFIG: AccuracyThresholdConfig = {
  thresholdRate: 0.8,
  sustainedFailureCount: 3,
};

describe('evaluateAccuracyThreshold', () => {
  it('is ok, resetting the streak to zero, when accuracy is at or above threshold', () => {
    expect(evaluateAccuracyThreshold(CONFIG, 0.8, 0)).toEqual({
      verdict: 'ok',
      consecutiveFailures: 0,
    });
    expect(evaluateAccuracyThreshold(CONFIG, 0.95, 2)).toEqual({
      verdict: 'ok',
      consecutiveFailures: 0,
    });
  });

  it('recalibrates on a first dip below threshold', () => {
    expect(evaluateAccuracyThreshold(CONFIG, 0.79, 0)).toEqual({
      verdict: 'recalibrate',
      consecutiveFailures: 1,
    });
  });

  it('keeps recalibrating while the streak is still under the sustained-failure count', () => {
    expect(evaluateAccuracyThreshold(CONFIG, 0.7, 1)).toEqual({
      verdict: 'recalibrate',
      consecutiveFailures: 2,
    });
  });

  it('deactivates once the streak reaches the sustained-failure count', () => {
    expect(evaluateAccuracyThreshold(CONFIG, 0.7, 2)).toEqual({
      verdict: 'deactivate',
      consecutiveFailures: 3,
    });
  });

  it('stays deactivate-worthy for a streak beyond the threshold count too', () => {
    expect(evaluateAccuracyThreshold(CONFIG, 0.5, 5)).toEqual({
      verdict: 'deactivate',
      consecutiveFailures: 6,
    });
  });

  it('a single good check after a streak of failures resets to ok, not deactivate', () => {
    expect(evaluateAccuracyThreshold(CONFIG, 0.85, 2)).toEqual({
      verdict: 'ok',
      consecutiveFailures: 0,
    });
  });

  it('throws when accuracyScore is outside [0, 1]', () => {
    expect(() => evaluateAccuracyThreshold(CONFIG, 1.1, 0)).toThrow(/accuracyScore/);
    expect(() => evaluateAccuracyThreshold(CONFIG, -0.1, 0)).toThrow(/accuracyScore/);
  });

  it('throws when priorConsecutiveFailures is negative or not a whole number', () => {
    expect(() => evaluateAccuracyThreshold(CONFIG, 0.5, -1)).toThrow(/priorConsecutiveFailures/);
    expect(() => evaluateAccuracyThreshold(CONFIG, 0.5, 1.5)).toThrow(/priorConsecutiveFailures/);
  });

  it('throws when thresholdRate is outside [0, 1]', () => {
    const bad: AccuracyThresholdConfig = { ...CONFIG, thresholdRate: 1.5 };
    expect(() => evaluateAccuracyThreshold(bad, 0.5, 0)).toThrow(/thresholdRate/);
  });

  it('throws when sustainedFailureCount is not a positive whole number', () => {
    const bad: AccuracyThresholdConfig = { ...CONFIG, sustainedFailureCount: 0 };
    expect(() => evaluateAccuracyThreshold(bad, 0.5, 0)).toThrow(/sustainedFailureCount/);
  });
});
