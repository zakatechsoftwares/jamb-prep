/**
 * Subject-combination onboarding wire shapes and service contract —
 * declared here so `apps/api` can be wired against it without importing
 * the database at module load, and `apps/mobile` shares the same types,
 * the same pattern every other candidate feature already uses.
 */

export interface SubjectCombinationOptionSubject {
  subjectId: number;
  subjectName: string;
  role: 'compulsory' | 'elective';
}

export interface SubjectCombinationOption {
  id: number;
  courseName: string;
  subjects: SubjectCombinationOptionSubject[];
}

export interface SelectSubjectCombinationInput {
  subjectCombinationId: number;
}

export interface SubjectCombinationService {
  listSubjectCombinations(): Promise<SubjectCombinationOption[]>;
  selectSubjectCombination(candidateUserId: number, input: SelectSubjectCombinationInput): Promise<void>;
}
