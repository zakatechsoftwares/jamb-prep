import { describe, expect, it } from 'vitest';
import { generateSyncId } from './sync-ids';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function sequence(values: number[]): () => number {
  let index = 0;
  return () => {
    const value = values[index % values.length]!;
    index += 1;
    return value;
  };
}

describe('generateSyncId', () => {
  it('produces a v4-shaped UUID', () => {
    const id = generateSyncId(sequence([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.15, 0.25, 0.35, 0.45, 0.55, 0.65]));
    expect(id).toMatch(UUID_V4_PATTERN);
  });

  it('is deterministic given the same draw sequence, for reproducibility in a test', () => {
    const draws = [0.01, 0.99, 0.5, 0.25, 0.75, 0.33, 0.66, 0.1, 0.2, 0.3, 0.4, 0.6, 0.7, 0.8, 0.9, 0.05];
    expect(generateSyncId(sequence(draws))).toBe(generateSyncId(sequence(draws)));
  });

  it('produces different ids for different draw sequences', () => {
    const first = generateSyncId(sequence([0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.09, 0.1, 0.11, 0.12, 0.13, 0.14, 0.15, 0.16]));
    const second = generateSyncId(sequence([0.91, 0.92, 0.93, 0.94, 0.95, 0.96, 0.97, 0.98, 0.99, 0.81, 0.82, 0.83, 0.84, 0.85, 0.86, 0.87]));
    expect(first).not.toBe(second);
  });

  it('throws when a draw falls outside [0, 1)', () => {
    expect(() => generateSyncId(() => 1)).toThrow(/\[0, 1\)/);
    expect(() => generateSyncId(() => -0.1)).toThrow(/\[0, 1\)/);
  });
});
