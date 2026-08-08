import {
  OPTION_LABELS,
  REVIEW_ACTIONS,
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

/** NOT YET IMPLEMENTED — tests first, per CLAUDE.md. */
export function parseOptionLabel(_value: unknown, _fieldName: string): OptionLabel {
  return OPTION_LABELS[0];
}

/** NOT YET IMPLEMENTED — tests first, per CLAUDE.md. */
export function parseDecisionInput(_raw: unknown): ParsedDecisionInput {
  return { action: REVIEW_ACTIONS[0], rejectionReason: null, edits: null };
}

/** NOT YET IMPLEMENTED — tests first, per CLAUDE.md. */
export function buildItemEditDiff(_current: ItemSnapshot, _patch: ItemEditPatch): ItemEditDiff {
  return {};
}

/** NOT YET IMPLEMENTED — tests first, per CLAUDE.md. */
export function canReveal(_riskTier: RiskTier, _hasReviewerAnswer: boolean): boolean {
  return false;
}

/** NOT YET IMPLEMENTED — tests first, per CLAUDE.md. */
export function agreesWithKey(
  _reviewerAnswer: OptionLabel | null,
  _key: OptionLabel,
): boolean | null {
  return null;
}
