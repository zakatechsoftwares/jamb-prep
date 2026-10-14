/**
 * Subject-tabbed navigation for the mock CBT runtime (plan 6: "subject
 * tabs, question palette"). Pure, no I/O — the mobile screen only renders
 * what this decides (rule 7).
 *
 * Three decisions, confirmed with the user:
 * - Questions are numbered per subject (English 1–60, Mathematics 1–40…),
 *   not 1–180 across the exam.
 * - Next/Previous run continuously through the whole exam: past a subject's
 *   last question they carry on into the next subject, so the arrows alone
 *   reach every question. Only the exam's very first and last questions
 *   have nowhere to go.
 * - A subject tab returns to the last question viewed in that subject, or
 *   its first question if it hasn't been visited. That memory lives only as
 *   long as the screen does; after a force-close and resume, every tab opens
 *   at question 1 (answers, flags and the timer are restored as before).
 */

export interface NavigableItem {
  itemId: number;
  subjectId: number;
}

export interface NavigableSubject {
  subjectId: number;
  name: string;
}

export interface SubjectSection {
  subjectId: number;
  name: string;
  itemIds: number[];
}

export interface ItemLocation {
  sectionIndex: number;
  subjectId: number;
  /** 1-based position within the item's own subject. */
  position: number;
  /** Number of items in that subject. */
  total: number;
}

/** Subject id → the item id last viewed in that subject. */
export type LastVisitedBySubject = Readonly<Record<number, number>>;

export function buildSubjectSections(
  subjects: readonly NavigableSubject[],
  items: readonly NavigableItem[],
): SubjectSection[] {
  if (items.length === 0) {
    throw new Error('buildSubjectSections: items must not be empty');
  }

  const sectionsBySubject = new Map<number, SubjectSection>();
  for (const subject of subjects) {
    if (sectionsBySubject.has(subject.subjectId)) {
      throw new Error(`buildSubjectSections: subject ${subject.subjectId} is listed twice`);
    }
    sectionsBySubject.set(subject.subjectId, {
      subjectId: subject.subjectId,
      name: subject.name,
      itemIds: [],
    });
  }

  const seenItemIds = new Set<number>();
  for (const item of items) {
    if (seenItemIds.has(item.itemId)) {
      throw new Error(`buildSubjectSections: item ${item.itemId} appears twice`);
    }
    seenItemIds.add(item.itemId);

    const section = sectionsBySubject.get(item.subjectId);
    if (!section) {
      throw new Error(
        `buildSubjectSections: item ${item.itemId} belongs to subject ${item.subjectId}, which is not in this exam`,
      );
    }
    section.itemIds.push(item.itemId);
  }

  const sections = [...sectionsBySubject.values()];
  const empty = sections.find((section) => section.itemIds.length === 0);
  if (empty) {
    throw new Error(`buildSubjectSections: subject ${empty.name} has no items`);
  }
  return sections;
}

export function locateItem(sections: readonly SubjectSection[], itemId: number): ItemLocation {
  for (const [sectionIndex, section] of sections.entries()) {
    const index = section.itemIds.indexOf(itemId);
    if (index !== -1) {
      return {
        sectionIndex,
        subjectId: section.subjectId,
        position: index + 1,
        total: section.itemIds.length,
      };
    }
  }
  throw new Error(`locateItem: item ${itemId} is not part of this exam`);
}

/**
 * The item Next or Previous moves to, crossing subject boundaries; null
 * only before the exam's first item or after its last.
 */
export function adjacentItemId(
  sections: readonly SubjectSection[],
  itemId: number,
  direction: 'next' | 'previous',
): number | null {
  const ordered = sections.flatMap((section) => section.itemIds);
  const index = ordered.indexOf(itemId);
  if (index === -1) {
    throw new Error(`adjacentItemId: item ${itemId} is not part of this exam`);
  }
  return ordered[direction === 'next' ? index + 1 : index - 1] ?? null;
}

/** The item a subject tab opens: where the candidate left off there, or its first item. */
export function subjectEntryItemId(
  sections: readonly SubjectSection[],
  subjectId: number,
  lastVisited: LastVisitedBySubject,
): number {
  const section = sections.find((candidate) => candidate.subjectId === subjectId);
  if (!section) {
    throw new Error(`subjectEntryItemId: subject ${subjectId} is not in this exam`);
  }

  const remembered = lastVisited[subjectId];
  if (remembered === undefined) {
    return section.itemIds[0]!;
  }
  if (!section.itemIds.includes(remembered)) {
    throw new Error(
      `subjectEntryItemId: remembered item ${remembered} does not belong to subject ${section.name}`,
    );
  }
  return remembered;
}

/** Returns a new map with `itemId` remembered as the last item viewed in its subject. */
export function recordVisit(
  sections: readonly SubjectSection[],
  lastVisited: LastVisitedBySubject,
  itemId: number,
): Record<number, number> {
  const { subjectId } = locateItem(sections, itemId);
  return { ...lastVisited, [subjectId]: itemId };
}

/** Answered count for one subject's tab; an item with no progress entry counts as unanswered. */
export function sectionProgress(
  section: SubjectSection,
  progress: Readonly<Record<number, { answered: boolean } | undefined>>,
): { answered: number; total: number } {
  const answered = section.itemIds.filter((itemId) => progress[itemId]?.answered === true).length;
  return { answered, total: section.itemIds.length };
}
