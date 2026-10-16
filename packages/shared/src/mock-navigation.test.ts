import { describe, expect, it } from 'vitest';
import {
  adjacentItemId,
  buildSubjectSections,
  locateItem,
  recordVisit,
  sectionProgress,
  subjectEntryItemId,
  type SubjectSection,
} from './mock-navigation';

const SUBJECTS = [
  { subjectId: 1, name: 'Use of English' },
  { subjectId: 2, name: 'Mathematics' },
  { subjectId: 3, name: 'Biology' },
];

// Deliberately interleaved: sections must follow the subject order and keep
// each subject's own item order, whatever order the items arrive in.
const ITEMS = [
  { itemId: 10, subjectId: 1 },
  { itemId: 20, subjectId: 2 },
  { itemId: 11, subjectId: 1 },
  { itemId: 30, subjectId: 3 },
  { itemId: 21, subjectId: 2 },
  { itemId: 12, subjectId: 1 },
];

function sections(): SubjectSection[] {
  return buildSubjectSections(SUBJECTS, ITEMS);
}

describe('buildSubjectSections', () => {
  it('groups items by subject, in subject order, keeping each subject’s item order', () => {
    expect(sections()).toEqual([
      { subjectId: 1, name: 'Use of English', itemIds: [10, 11, 12] },
      { subjectId: 2, name: 'Mathematics', itemIds: [20, 21] },
      { subjectId: 3, name: 'Biology', itemIds: [30] },
    ]);
  });

  it('throws when there are no items', () => {
    expect(() => buildSubjectSections(SUBJECTS, [])).toThrow(/items/);
  });

  it('throws on an item whose subject is not in the exam', () => {
    expect(() => buildSubjectSections(SUBJECTS, [...ITEMS, { itemId: 99, subjectId: 9 }])).toThrow(
      /subject 9/,
    );
  });

  it('throws on a duplicate item id', () => {
    expect(() => buildSubjectSections(SUBJECTS, [...ITEMS, { itemId: 10, subjectId: 1 }])).toThrow(
      /10/,
    );
  });

  it('throws on a duplicate subject id', () => {
    expect(() =>
      buildSubjectSections([...SUBJECTS, { subjectId: 1, name: 'Again' }], ITEMS),
    ).toThrow(/subject 1/);
  });

  it('throws on a subject with no items — the exam would have an empty tab', () => {
    expect(() =>
      buildSubjectSections([...SUBJECTS, { subjectId: 4, name: 'Physics' }], ITEMS),
    ).toThrow(/Physics/);
  });
});

describe('locateItem', () => {
  it('numbers each item within its own subject, counting from 1', () => {
    expect(locateItem(sections(), 10)).toEqual({ sectionIndex: 0, subjectId: 1, position: 1, total: 3 });
    expect(locateItem(sections(), 12)).toEqual({ sectionIndex: 0, subjectId: 1, position: 3, total: 3 });
    expect(locateItem(sections(), 21)).toEqual({ sectionIndex: 1, subjectId: 2, position: 2, total: 2 });
    expect(locateItem(sections(), 30)).toEqual({ sectionIndex: 2, subjectId: 3, position: 1, total: 1 });
  });

  it('throws for an item not in the exam', () => {
    expect(() => locateItem(sections(), 99)).toThrow(/99/);
  });
});

describe('adjacentItemId', () => {
  it('moves within a subject', () => {
    expect(adjacentItemId(sections(), 10, 'next')).toBe(11);
    expect(adjacentItemId(sections(), 11, 'previous')).toBe(10);
  });

  it('continues into the next subject from a subject’s last question', () => {
    expect(adjacentItemId(sections(), 12, 'next')).toBe(20);
    expect(adjacentItemId(sections(), 21, 'next')).toBe(30);
  });

  it('goes back to the previous subject’s last question from a subject’s first', () => {
    expect(adjacentItemId(sections(), 20, 'previous')).toBe(12);
    expect(adjacentItemId(sections(), 30, 'previous')).toBe(21);
  });

  it('returns null only at the very first and very last question of the exam', () => {
    expect(adjacentItemId(sections(), 10, 'previous')).toBeNull();
    expect(adjacentItemId(sections(), 30, 'next')).toBeNull();
  });

  it('walks every question exactly once, forwards and backwards', () => {
    const forward: number[] = [];
    let current: number | null = 10;
    while (current !== null) {
      forward.push(current);
      current = adjacentItemId(sections(), current, 'next');
    }
    expect(forward).toEqual([10, 11, 12, 20, 21, 30]);

    const backward: number[] = [];
    current = 30;
    while (current !== null) {
      backward.push(current);
      current = adjacentItemId(sections(), current, 'previous');
    }
    expect(backward).toEqual([...forward].reverse());
  });

  it('throws for an item not in the exam', () => {
    expect(() => adjacentItemId(sections(), 99, 'next')).toThrow(/99/);
  });
});

describe('subjectEntryItemId', () => {
  it('opens a subject’s first question when it has not been visited', () => {
    expect(subjectEntryItemId(sections(), 2, {})).toBe(20);
  });

  it('returns to the last question viewed in that subject', () => {
    expect(subjectEntryItemId(sections(), 1, { 1: 12, 2: 21 })).toBe(12);
    expect(subjectEntryItemId(sections(), 2, { 1: 12, 2: 21 })).toBe(21);
  });

  it('throws for a subject not in the exam', () => {
    expect(() => subjectEntryItemId(sections(), 9, {})).toThrow(/subject 9/);
  });

  it('throws when the remembered question belongs to a different subject', () => {
    expect(() => subjectEntryItemId(sections(), 2, { 2: 10 })).toThrow(/10/);
  });
});

describe('recordVisit', () => {
  it('remembers the item under its own subject, without mutating the input', () => {
    const before = { 1: 10 };
    const after = recordVisit(sections(), before, 21);
    expect(after).toEqual({ 1: 10, 2: 21 });
    expect(before).toEqual({ 1: 10 });
  });

  it('replaces the previous visit in the same subject', () => {
    expect(recordVisit(sections(), { 1: 10 }, 12)).toEqual({ 1: 12 });
  });

  it('throws for an item not in the exam', () => {
    expect(() => recordVisit(sections(), {}, 99)).toThrow(/99/);
  });
});

describe('sectionProgress', () => {
  it('counts answered questions in one subject, ignoring other subjects', () => {
    const progress = {
      10: { answered: true },
      11: { answered: false },
      12: { answered: true },
      20: { answered: true },
    };
    expect(sectionProgress(sections()[0]!, progress)).toEqual({ answered: 2, total: 3 });
    expect(sectionProgress(sections()[1]!, progress)).toEqual({ answered: 1, total: 2 });
  });

  it('treats an item with no progress entry as unanswered', () => {
    expect(sectionProgress(sections()[2]!, {})).toEqual({ answered: 0, total: 1 });
  });
});
