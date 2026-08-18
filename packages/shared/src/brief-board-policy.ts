import type { BriefStatus } from './brief-lifecycle';
import type { IllustrationTicketStatus } from './illustration-lifecycle';
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

/**
 * A contributor discovers mid-authoring, not from the brief itself, that a
 * specific item needs a figure — `objectives.requires_human_authorship` is
 * one undifferentiated flag covering diagram-dependent, reading-text and
 * policy/current-affairs objectives alike, so it cannot predict this. The
 * sketch photo itself travels as a multipart file alongside this JSON, not
 * as a field on it.
 */
export interface RequestDiagramInput {
  figureDescription: string;
}

export interface ContributedItemInput {
  stem: string;
  explanation: string;
  methodSteps: string[];
  cognitiveLevel: string;
  authorDifficulty: number;
  expectedTimeSeconds: number;
  options: ContributedOptionInput[];
  /** Present when this item needs a figure — defers promotion to `pending_review` until an illustrator completes the ticket. */
  diagramRequest: RequestDiagramInput | null;
}

/**
 * A raw file's bytes, typed as `Uint8Array` rather than Node's `Buffer` so
 * this package (imported by `apps/mobile`'s React Native runtime too) never
 * depends on a Node-only global. `apps/api`'s route handlers, which are
 * Node-only, convert to/from `Buffer` at their own boundary.
 */
export interface SketchPhotoUpload {
  bytes: Uint8Array;
  contentType: string;
}

export interface BriefBoardService {
  listOpenBriefs(): Promise<BriefSummary[]>;
  claimBrief(briefId: number, contributorReviewerId: number): Promise<BriefSummary>;
  submitContributedItem(
    briefId: number,
    contributorReviewerId: number,
    draft: ContributedItemInput,
  ): Promise<{ itemId: number }>;
  /** Used instead of `submitContributedItem` when `draft.diagramRequest` is set. */
  submitContributedItemWithDiagram(
    briefId: number,
    contributorReviewerId: number,
    draft: ContributedItemInput,
    sketchPhoto: SketchPhotoUpload,
  ): Promise<{ itemId: number }>;
}

export interface IllustrationTicketSummary {
  id: number;
  itemId: number;
  figureDescription: string;
  status: IllustrationTicketStatus;
  claimedByUserId: number | null;
}

export interface CompleteIllustrationInput {
  svgMarkup: string;
  altText: string;
}

/**
 * The illustrator queue (plan 7.12 step 5): any active reviewer-pool
 * account may browse and claim, matching the brief board's own "one pool,
 * no role wall" decision — no `illustrator` role exists in `PANEL_ROLES`.
 */
export interface IllustrationBoardService {
  listOpenTickets(): Promise<IllustrationTicketSummary[]>;
  claimTicket(ticketId: number, illustratorReviewerId: number): Promise<IllustrationTicketSummary>;
  completeTicket(
    ticketId: number,
    illustratorReviewerId: number,
    input: CompleteIllustrationInput,
  ): Promise<{ ok: true }>;
  loadSketchPhoto(ticketId: number): Promise<SketchPhotoUpload | null>;
}
