import type { BriefStatus } from './brief-lifecycle';
import type { OptionLabel } from './item-lifecycle';

/**
 * The contributor brief board's wire shapes and the service contract
 * `apps/api`'s brief routes need from it (plan 7.12, canonical session 11)
 * — declared here, the same way `ReviewQueueService` etc. are, so the API
 * layer can be wired against it without importing the database at module
 * load, and `apps/admin` can share the same types.
 */

export interface BriefSummary {
  id: number;
  objectiveId: number;
  itemCount: number;
  difficultySpread: unknown;
  cognitiveLevels: unknown;
  styleNotes: string | null;
  feeKobo: number;
  /** ISO 8601 on the wire. */
  deadline: string;
  status: BriefStatus;
  claimedByUserId: number | null;
}

export interface CreateBriefInput {
  objectiveId: number;
  itemCount: number;
  difficultySpread: Record<string, unknown>;
  cognitiveLevels: Record<string, unknown>;
  styleNotes: string | null;
  feeKobo: number;
  /** ISO 8601 on the wire. */
  deadline: string;
}

export interface ContributedOptionInput {
  label: OptionLabel;
  text: string;
  isCorrect: boolean;
  distractorRationale: string | null;
}

export interface ContributedItemInput {
  stem: string;
  explanation: string;
  methodSteps: string[];
  cognitiveLevel: string;
  authorDifficulty: number;
  expectedTimeSeconds: number;
  options: ContributedOptionInput[];
}

export interface BriefBoardService {
  listOpenBriefs(): Promise<BriefSummary[]>;
  claimBrief(briefId: number, contributorReviewerId: number): Promise<BriefSummary>;
  submitContributedItem(
    briefId: number,
    contributorReviewerId: number,
    draft: ContributedItemInput,
  ): Promise<{ itemId: number }>;
}
