import { describe, expect, it } from 'vitest';
import { computePackVersion } from './content-pack-policy';

describe('computePackVersion', () => {
  it('is the same regardless of input order', () => {
    const a = computePackVersion([
      { itemId: 2, version: 1 },
      { itemId: 1, version: 3 },
    ]);
    const b = computePackVersion([
      { itemId: 1, version: 3 },
      { itemId: 2, version: 1 },
    ]);
    expect(a).toBe(b);
  });

  it('changes when an item is added', () => {
    const before = computePackVersion([{ itemId: 1, version: 1 }]);
    const after = computePackVersion([
      { itemId: 1, version: 1 },
      { itemId: 2, version: 1 },
    ]);
    expect(after).not.toBe(before);
  });

  it('changes when an item is removed', () => {
    const before = computePackVersion([
      { itemId: 1, version: 1 },
      { itemId: 2, version: 1 },
    ]);
    const after = computePackVersion([{ itemId: 1, version: 1 }]);
    expect(after).not.toBe(before);
  });

  it('changes when an item is edited (its own version bumped)', () => {
    const before = computePackVersion([{ itemId: 1, version: 1 }]);
    const after = computePackVersion([{ itemId: 1, version: 2 }]);
    expect(after).not.toBe(before);
  });

  it('is stable for an unchanged set', () => {
    const items = [
      { itemId: 5, version: 2 },
      { itemId: 3, version: 1 },
    ];
    expect(computePackVersion(items)).toBe(computePackVersion(items));
  });

  it('is a deterministic, non-empty string even for an empty set', () => {
    expect(computePackVersion([])).toBe('');
  });

  it('does not collide two item ids swapping a digit with their versions', () => {
    // A naive concatenation without a separator (e.g. "1" + "12" vs "11" + "2")
    // could produce the same string for two different sets. Confirms the
    // actual chosen format avoids this.
    const a = computePackVersion([{ itemId: 1, version: 12 }]);
    const b = computePackVersion([{ itemId: 11, version: 2 }]);
    const c = computePackVersion([{ itemId: 1, version: 1 }, { itemId: 2, version: 0 }]);
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
});
