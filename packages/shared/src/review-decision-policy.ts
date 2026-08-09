import {
  OPTION_LABELS,
  REJECTION_REASONS,
  REVIEW_ACTIONS,
  type ApprovalRoute,
  type IndependentSolveVerdict,
  type ItemStatus,
  type OptionLabel,
  type RejectionReason,
  type ReviewAction,
  type RiskTier,
} from './item-lifecycle';

/**
 * A patch to an item's editable fields, as `edit_and_approve` accepts it
 * (plan 7.9's "inline editing"). Every field is optional — a reviewer edits
 * only what needs correcting, not the whole item.
 */
export interface ItemEditPatch {
  stem?: string;
  options?: Partial<Record<OptionLabel, string>>;
  /** The corrected key, when the reviewer is changing which option is right. */
  key?: OptionLabel;
  explanation?: string;
  objectiveId?: number;
}

/** The item's current editable fields, as read from the database. */
export interface ItemSnapshot {
  stem: string;
  options: Record<OptionLabel, string>;
  key: OptionLabel;
  explanation: string;
  objectiveId: number;
}

export interface FieldDiff<T> {
  before: T;
  after: T;
}

/**
 * What actually changed between an `ItemSnapshot` and an `ItemEditPatch`.
 * Only changed fields appear — a field present in the patch but equal to its
 * current value is not a change and is omitted, all the way down: an
 * unchanged option label inside a changed `options` patch does not appear
 * in `diff.options` either.
 */
export interface ItemEditDiff {
  stem?: FieldDiff<string>;
  options?: Partial<Record<OptionLabel, FieldDiff<string>>>;
  key?: FieldDiff<OptionLabel>;
  explanation?: FieldDiff<string>;
  objectiveId?: FieldDiff<number>;
}

export interface ParsedDecisionInput {
  action: ReviewAction;
  /** Present only for `reject`; null for every other action. */
  rejectionReason: RejectionReason | null;
  /** Present only for `edit_and_approve`; null for every other action. */
  edits: ItemEditPatch | null;
}

const EDIT_PATCH_FIELDS = ['stem', 'options', 'key', 'explanation', 'objectiveId'] as const;

/**
 * Parses one of A/B/C/D out of an untrusted value, naming the offending
 * field in the error so a bad request is diagnosable from the message
 * alone. Shared by `solve`'s `answer` and `edits.key`.
 */
export function parseOptionLabel(value: unknown, fieldName: string): OptionLabel {
  if (typeof value === 'string' && (OPTION_LABELS as readonly string[]).includes(value)) {
    return value as OptionLabel;
  }

  throw new Error(
    `${fieldName} must be one of ${OPTION_LABELS.join(', ')}, got ${JSON.stringify(value)}`,
  );
}

/**
 * Plan 7.10: the tool requires the reviewer's own answer before the
 * proposed key is revealed — the single highest-value control in the
 * framework. Scoped to `high` risk_tier, which is exactly "every item
 * containing a calculation" (plan 7.3): the category where a confidently
 * wrong generated item is both most likely and hardest to catch by reading.
 */
export function canReveal(riskTier: RiskTier, hasReviewerAnswer: boolean): boolean {
  return riskTier !== 'high' || hasReviewerAnswer;
}

/**
 * Returns null specifically when no blind answer was ever recorded, rather
 * than treating "never solved" as "disagreed". Collapsing the two would
 * corrupt the reviewer accuracy measurement in 7.11, which depends on
 * knowing whether a comparison happened at all.
 */
export function agreesWithKey(
  reviewerAnswer: OptionLabel | null,
  key: OptionLabel,
): boolean | null {
  return reviewerAnswer === null ? null : reviewerAnswer === key;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string, got ${JSON.stringify(value)}`);
  }
  return value.trim();
}

function assertPositiveInteger(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${fieldName} must be a positive whole number, got ${JSON.stringify(value)}`);
  }
  return value;
}

function parseEditPatch(raw: unknown): ItemEditPatch {
  if (!isPlainObject(raw)) {
    throw new Error(`edits must be an object, got ${JSON.stringify(raw)}`);
  }

  const keys = Object.keys(raw);
  if (keys.length === 0) {
    throw new Error(`edits must include at least one of ${EDIT_PATCH_FIELDS.join(', ')}`);
  }

  for (const key of keys) {
    if (!(EDIT_PATCH_FIELDS as readonly string[]).includes(key)) {
      throw new Error(
        `edits.${key} is not an editable field — allowed fields are ${EDIT_PATCH_FIELDS.join(', ')}`,
      );
    }
  }

  const patch: ItemEditPatch = {};

  if ('stem' in raw) {
    patch.stem = assertNonEmptyString(raw.stem, 'edits.stem');
  }
  if ('explanation' in raw) {
    patch.explanation = assertNonEmptyString(raw.explanation, 'edits.explanation');
  }
  if ('objectiveId' in raw) {
    patch.objectiveId = assertPositiveInteger(raw.objectiveId, 'edits.objectiveId');
  }
  if ('key' in raw) {
    patch.key = parseOptionLabel(raw.key, 'edits.key');
  }
  if ('options' in raw) {
    if (!isPlainObject(raw.options) || Object.keys(raw.options).length === 0) {
      throw new Error('edits.options must be a non-empty object mapping option labels to new text');
    }

    const options: Partial<Record<OptionLabel, string>> = {};
    for (const [label, text] of Object.entries(raw.options)) {
      if (!(OPTION_LABELS as readonly string[]).includes(label)) {
        throw new Error(
          `edits.options.${label} is not a recognised option label — must be one of ${OPTION_LABELS.join(', ')}`,
        );
      }
      options[label as OptionLabel] = assertNonEmptyString(text, `edits.options.${label}`);
    }
    patch.options = options;
  }

  return patch;
}

/**
 * The `POST /review/:itemId/decide` boundary validator. Treats the request
 * body as fully untrusted — this is the parse step for raw JSON, not a
 * check against an already-typed value.
 *
 * `rejectionReason` must be exactly one of the fixed taxonomy (7.9): a
 * near-miss like `'WRONG_KEY'` is rejected exactly as free text is,
 * because a fixed enum that quietly accepts a case-mismatch is not fixed.
 * Conditioning mirrors the database CHECK constraints added in migration
 * 0012 (`rejectionReason` required iff `reject`) and 0014 (`edits`
 * required iff `edit_and_approve`) — stated here so a malformed request
 * never reaches the database at all.
 *
 * Deliberately does not check whether an edit patch represents a real
 * change against the current item — that requires the database row, which
 * this function never sees. See `buildItemEditDiff`.
 */
export function parseDecisionInput(raw: unknown): ParsedDecisionInput {
  if (!isPlainObject(raw)) {
    throw new Error(`decision input must be an object, got ${JSON.stringify(raw)}`);
  }

  if (
    typeof raw.action !== 'string' ||
    !(REVIEW_ACTIONS as readonly string[]).includes(raw.action)
  ) {
    throw new Error(
      `action must be one of ${REVIEW_ACTIONS.join(', ')}, got ${JSON.stringify(raw.action)}`,
    );
  }
  const action = raw.action as ReviewAction;

  let rejectionReason: RejectionReason | null = null;
  if (action === 'reject') {
    if (
      typeof raw.rejectionReason !== 'string' ||
      !(REJECTION_REASONS as readonly string[]).includes(raw.rejectionReason)
    ) {
      throw new Error(
        `rejectionReason must be one of ${REJECTION_REASONS.join(', ')} when action is reject, got ${JSON.stringify(raw.rejectionReason)}`,
      );
    }
    rejectionReason = raw.rejectionReason as RejectionReason;
  } else if (raw.rejectionReason !== undefined) {
    throw new Error(`rejectionReason is only valid when action is reject, not ${action}`);
  }

  let edits: ItemEditPatch | null = null;
  if (action === 'edit_and_approve') {
    if (raw.edits === undefined) {
      throw new Error('edits is required when action is edit_and_approve');
    }
    edits = parseEditPatch(raw.edits);
  } else if (raw.edits !== undefined) {
    throw new Error(`edits is only valid when action is edit_and_approve, not ${action}`);
  }

  return { action, rejectionReason, edits };
}

/**
 * What an edit patch would actually change against the item's current row.
 * Throws when the resulting diff is empty — a patch whose every field
 * matches the current value is not an edit, it is an `approve` wearing an
 * `edit_and_approve` costume, and recording an empty diff would make the
 * audit trail claim a change that never happened.
 */
export function buildItemEditDiff(current: ItemSnapshot, patch: ItemEditPatch): ItemEditDiff {
  const diff: ItemEditDiff = {};

  if (patch.stem !== undefined && patch.stem !== current.stem) {
    diff.stem = { before: current.stem, after: patch.stem };
  }
  if (patch.explanation !== undefined && patch.explanation !== current.explanation) {
    diff.explanation = { before: current.explanation, after: patch.explanation };
  }
  if (patch.objectiveId !== undefined && patch.objectiveId !== current.objectiveId) {
    diff.objectiveId = { before: current.objectiveId, after: patch.objectiveId };
  }
  if (patch.key !== undefined && patch.key !== current.key) {
    diff.key = { before: current.key, after: patch.key };
  }
  if (patch.options) {
    const optionsDiff: Partial<Record<OptionLabel, FieldDiff<string>>> = {};

    for (const label of OPTION_LABELS) {
      const after = patch.options[label];
      if (after !== undefined && after !== current.options[label]) {
        optionsDiff[label] = { before: current.options[label], after };
      }
    }

    if (Object.keys(optionsDiff).length > 0) {
      diff.options = optionsDiff;
    }
  }

  if (Object.keys(diff).length === 0) {
    throw new Error('edit patch produces no actual change against the current item');
  }

  return diff;
}

/**
 * The `POST /review/:itemId/resolve-escalation` boundary validator (session
 * 04's guard 5: only a moderator resolves an escalated item). Deliberately
 * narrower than `parseDecisionInput`: a moderator ruling on an escalated
 * item only ever approves or rejects it — there is no `edit_and_approve`
 * here and no further `escalate` from `escalated`, so those two are refused
 * exactly like nonsense would be, not merely left unsupported by omission.
 * `rejectionReason` and `edits` are never valid on this input, unlike
 * `parseDecisionInput` where each is valid conditionally.
 */
export function parseResolveEscalationInput(raw: unknown): ResolveEscalationInput {
  if (!isPlainObject(raw)) {
    throw new Error(`resolution input must be an object, got ${JSON.stringify(raw)}`);
  }

  if (raw.action !== 'approve' && raw.action !== 'reject') {
    throw new Error(`action must be one of approve, reject, got ${JSON.stringify(raw.action)}`);
  }

  if (raw.rejectionReason !== undefined) {
    throw new Error('rejectionReason is not valid when resolving an escalation');
  }
  if (raw.edits !== undefined) {
    throw new Error('edits is not valid when resolving an escalation');
  }

  return { action: raw.action };
}

// ---------------------------------------------------------------------------
// The decision service contract. Declared here, implemented in
// @jamb/db/review-decision-repository.ts, and consumed by apps/api the same
// way ReviewQueueItem / ReviewQueueService already are: the shape lives in
// one place so the API layer can be wired against it without importing the
// database at module load.
// ---------------------------------------------------------------------------

export type SolveOutcome =
  | { ok: true; itemId: number; answer: OptionLabel }
  | { ok: false; reason: 'not_claimed_by_you' | 'already_answered' };

export interface RevealResult {
  correctOption: OptionLabel;
  explanation: string;
  verdict: IndependentSolveVerdict;
  agreesWithKey: boolean | null;
}

export type RevealOutcome =
  ({ ok: true } & RevealResult) | { ok: false; reason: 'not_claimed_by_you' | 'not_yet_solved' };

export interface DecideInput extends ParsedDecisionInput {
  /**
   * Client-supplied idempotency key for the offline reviewer workspace
   * (7.9): decisions are cached on the device and synced on reconnection,
   * and a retry must never record the same decision twice. Generated
   * server-side when absent, which makes that one request safe but not its
   * retries — offline clients should always supply their own.
   */
  idempotencyKey?: string;
}

export interface DecideResult {
  itemId: number;
  status: ItemStatus;
  approvalRoute: ApprovalRoute | null;
}

export type DecideOutcome =
  | ({ ok: true } & DecideResult)
  | { ok: false; reason: 'not_claimed_by_you' }
  | { ok: false; reason: 'invalid_transition'; message: string };

/** What `apps/api`'s decision routes need from the review workflow. */
export interface ReviewDecisionService {
  submitBlindAnswer(reviewerId: number, itemId: number, answer: OptionLabel): Promise<SolveOutcome>;
  revealItem(reviewerId: number, itemId: number): Promise<RevealOutcome>;
  decideOnItem(reviewerId: number, itemId: number, input: DecideInput): Promise<DecideOutcome>;
}

/**
 * A moderator's ruling on an item in `escalated` (session 04's guard 5). A
 * separate input/outcome/service from the decision trio above, not a mode
 * of `DecideInput` — this is `decideOnItem`'s sibling for the one state
 * only a moderator may resolve, not a variant reached through it.
 */
export interface ResolveEscalationInput {
  action: 'approve' | 'reject';
}

export type ResolveEscalationOutcome =
  ({ ok: true } & DecideResult) | { ok: false; reason: 'invalid_transition'; message: string };

/** What `apps/api`'s escalation-resolution route needs from the review workflow. */
export interface ReviewEscalationService {
  resolveEscalation(
    reviewerId: number,
    itemId: number,
    input: ResolveEscalationInput,
  ): Promise<ResolveEscalationOutcome>;
}
