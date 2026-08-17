import { describe, expect, it } from 'vitest';
import {
  computeEffectiveNow,
  computeRemainingSeconds,
  computeSessionEndAt,
  hasExpired,
} from './exam-timer';

describe('computeSessionEndAt', () => {
  it('adds the exam duration to the start time', () => {
    expect(computeSessionEndAt(new Date('2026-05-01T09:00:00.000Z'), 120)).toEqual(
      new Date('2026-05-01T11:00:00.000Z'),
    );
  });

  it('throws for a non-positive duration', () => {
    expect(() => computeSessionEndAt(new Date(), 0)).toThrow(/totalDurationMinutes/);
    expect(() => computeSessionEndAt(new Date(), -5)).toThrow(/totalDurationMinutes/);
  });

  it('throws for an invalid startedAt', () => {
    expect(() => computeSessionEndAt(new Date('not-a-date'), 120)).toThrow(/startedAt/);
  });
});

describe('computeEffectiveNow', () => {
  it('is the actual clock reading when it has moved forward', () => {
    const lastObservedAt = new Date('2026-05-01T09:00:00.000Z');
    const actualNow = new Date('2026-05-01T09:10:00.000Z');
    expect(computeEffectiveNow(actualNow, lastObservedAt)).toEqual(actualNow);
  });

  it('DECISION: ratchets to lastObservedAt when the clock appears to move backward, so winding the device clock back can never recover time', () => {
    const lastObservedAt = new Date('2026-05-01T09:10:00.000Z');
    const actualNow = new Date('2026-05-01T09:00:00.000Z'); // rolled back 10 minutes
    expect(computeEffectiveNow(actualNow, lastObservedAt)).toEqual(lastObservedAt);
  });

  it('returns the same instant when the clock has not moved', () => {
    const now = new Date('2026-05-01T09:00:00.000Z');
    expect(computeEffectiveNow(now, now)).toEqual(now);
  });

  it('throws for an invalid actualNow or lastObservedAt', () => {
    const valid = new Date('2026-05-01T09:00:00.000Z');
    expect(() => computeEffectiveNow(new Date('bad'), valid)).toThrow(/actualNow/);
    expect(() => computeEffectiveNow(valid, new Date('bad'))).toThrow(/lastObservedAt/);
  });
});

describe('computeRemainingSeconds', () => {
  it('returns the whole seconds between now and the end time', () => {
    const endAt = new Date('2026-05-01T11:00:00.000Z');
    const effectiveNow = new Date('2026-05-01T09:50:00.000Z'); // 70 minutes remain until end
    expect(computeRemainingSeconds(endAt, effectiveNow)).toBe(70 * 60);
  });

  it('never returns negative — floors at zero once expired', () => {
    const endAt = new Date('2026-05-01T11:00:00.000Z');
    const effectiveNow = new Date('2026-05-01T11:30:00.000Z'); // 30 minutes past end
    expect(computeRemainingSeconds(endAt, effectiveNow)).toBe(0);
  });

  it('rounds down a partial second rather than up', () => {
    const endAt = new Date('2026-05-01T11:00:00.500Z');
    const effectiveNow = new Date('2026-05-01T11:00:00.000Z');
    expect(computeRemainingSeconds(endAt, effectiveNow)).toBe(0);
  });

  it('throws for an invalid endAt or effectiveNow', () => {
    const valid = new Date('2026-05-01T09:00:00.000Z');
    expect(() => computeRemainingSeconds(new Date('bad'), valid)).toThrow(/endAt/);
    expect(() => computeRemainingSeconds(valid, new Date('bad'))).toThrow(/effectiveNow/);
  });
});

describe('hasExpired', () => {
  it('is false before the end time', () => {
    const endAt = new Date('2026-05-01T11:00:00.000Z');
    expect(hasExpired(endAt, new Date('2026-05-01T10:59:59.000Z'))).toBe(false);
  });

  it('is true exactly at the end time', () => {
    const endAt = new Date('2026-05-01T11:00:00.000Z');
    expect(hasExpired(endAt, endAt)).toBe(true);
  });

  it('is true after the end time', () => {
    const endAt = new Date('2026-05-01T11:00:00.000Z');
    expect(hasExpired(endAt, new Date('2026-05-01T11:00:01.000Z'))).toBe(true);
  });
});
