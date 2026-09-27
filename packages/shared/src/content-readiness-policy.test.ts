import { describe, expect, it } from 'vitest';
import { computeSubjectCombinationReadiness, type SubjectCombinationInput } from './content-readiness-policy';

const REQUIRED = { compulsory: 60, elective: 40 };

const ENGLISH = { subjectId: 1, subjectName: 'Use of English', role: 'compulsory' as const };
const MATHS = { subjectId: 2, subjectName: 'Mathematics', role: 'elective' as const };
const PHYSICS = { subjectId: 3, subjectName: 'Physics', role: 'elective' as const };
const CHEMISTRY = { subjectId: 4, subjectName: 'Chemistry', role: 'elective' as const };
const BIOLOGY = { subjectId: 5, subjectName: 'Biology', role: 'elective' as const };

const ENGINEERING: SubjectCombinationInput = {
  id: 100,
  courseName: 'Electrical Engineering',
  subjects: [ENGLISH, MATHS, PHYSICS, CHEMISTRY],
};

const MEDICINE: SubjectCombinationInput = {
  id: 200,
  courseName: 'Medicine and Surgery',
  subjects: [ENGLISH, BIOLOGY, CHEMISTRY, PHYSICS],
};

describe('computeSubjectCombinationReadiness', () => {
  it('marks a combination ready when every subject meets its role requirement', () => {
    const approvedCounts = new Map([
      [ENGLISH.subjectId, 60],
      [MATHS.subjectId, 40],
      [PHYSICS.subjectId, 40],
      [CHEMISTRY.subjectId, 40],
    ]);

    const [result] = computeSubjectCombinationReadiness([ENGINEERING], REQUIRED, approvedCounts);

    expect(result?.ready).toBe(true);
    expect(result?.subjects.every((subject) => subject.ready)).toBe(true);
  });

  it('marks a combination not ready when one elective subject falls short, without affecting its siblings', () => {
    const approvedCounts = new Map([
      [ENGLISH.subjectId, 60],
      [MATHS.subjectId, 40],
      [PHYSICS.subjectId, 39],
      [CHEMISTRY.subjectId, 40],
    ]);

    const [result] = computeSubjectCombinationReadiness([ENGINEERING], REQUIRED, approvedCounts);

    expect(result?.ready).toBe(false);
    const bySubject = new Map(result?.subjects.map((subject) => [subject.subjectId, subject]));
    expect(bySubject.get(PHYSICS.subjectId)?.ready).toBe(false);
    expect(bySubject.get(PHYSICS.subjectId)?.approvedCount).toBe(39);
    expect(bySubject.get(PHYSICS.subjectId)?.requiredCount).toBe(40);
    expect(bySubject.get(MATHS.subjectId)?.ready).toBe(true);
    expect(bySubject.get(CHEMISTRY.subjectId)?.ready).toBe(true);
    expect(bySubject.get(ENGLISH.subjectId)?.ready).toBe(true);
  });

  it('treats a subject missing from the approved-counts map as zero, not an error', () => {
    const approvedCounts = new Map([[ENGLISH.subjectId, 60]]);

    const [result] = computeSubjectCombinationReadiness([ENGINEERING], REQUIRED, approvedCounts);

    const maths = result?.subjects.find((subject) => subject.subjectId === MATHS.subjectId);
    expect(maths?.approvedCount).toBe(0);
    expect(maths?.ready).toBe(false);
    expect(result?.ready).toBe(false);
  });

  it('computes two combinations sharing a subject independently', () => {
    const approvedCounts = new Map([
      [ENGLISH.subjectId, 60],
      [MATHS.subjectId, 40],
      [PHYSICS.subjectId, 40],
      [CHEMISTRY.subjectId, 40],
      [BIOLOGY.subjectId, 10],
    ]);

    const [engineering, medicine] = computeSubjectCombinationReadiness(
      [ENGINEERING, MEDICINE],
      REQUIRED,
      approvedCounts,
    );

    expect(engineering?.ready).toBe(true);
    expect(medicine?.ready).toBe(false);
    const medicineBiology = medicine?.subjects.find((subject) => subject.subjectId === BIOLOGY.subjectId);
    expect(medicineBiology?.approvedCount).toBe(10);
    expect(medicineBiology?.ready).toBe(false);
  });

  it('throws when a required-count value is not a positive integer', () => {
    expect(() =>
      computeSubjectCombinationReadiness([ENGINEERING], { compulsory: 0, elective: 40 }, new Map()),
    ).toThrow(/compulsory/);
    expect(() =>
      computeSubjectCombinationReadiness([ENGINEERING], { compulsory: 60, elective: 40.5 }, new Map()),
    ).toThrow(/elective/);
  });

  it('throws when a combination id is not a positive integer', () => {
    const bad: SubjectCombinationInput = { ...ENGINEERING, id: 0 };
    expect(() => computeSubjectCombinationReadiness([bad], REQUIRED, new Map())).toThrow(/id/);
  });

  it('throws when a subject id is not a positive integer', () => {
    const bad: SubjectCombinationInput = {
      ...ENGINEERING,
      subjects: [{ ...ENGLISH, subjectId: -1 }],
    };
    expect(() => computeSubjectCombinationReadiness([bad], REQUIRED, new Map())).toThrow(/subjectId/);
  });

  it('throws when an approved-counts value is negative', () => {
    const approvedCounts = new Map([[ENGLISH.subjectId, -5]]);
    expect(() => computeSubjectCombinationReadiness([ENGINEERING], REQUIRED, approvedCounts)).toThrow(
      /approvedCount/,
    );
  });
});
