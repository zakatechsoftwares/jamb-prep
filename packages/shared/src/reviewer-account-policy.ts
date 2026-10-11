import type { PanelRole, ReviewerStatus } from './item-lifecycle';

/**
 * Content-lead account management for the review panel (plan 7.8: the
 * content lead "recruits and calibrates the panel"). This is the
 * hand-provisioned half of onboarding — the self-service application form
 * and calibration set are later work, which is why every account created
 * here starts `active` rather than `applied`.
 *
 * A content lead may create and manage every panel role except their own.
 * Content-lead accounts stay a direct database action: letting one content
 * lead create, reset or suspend another would make every content-lead
 * session a route to taking over every other one.
 */
export const ASSIGNABLE_REVIEWER_ROLES = [
  'reviewer',
  'moderator',
  'contributor',
] as const satisfies readonly PanelRole[];

export type AssignableReviewerRole = (typeof ASSIGNABLE_REVIEWER_ROLES)[number];

/**
 * The only two statuses a content lead toggles by hand. `removed` is set by
 * `sweepReviewerAccuracy` for sustained accuracy failure (7.11) and is
 * deliberately not undone by a button; `applied`/`calibrating` belong to the
 * not-yet-built application flow.
 */
export const MANAGEABLE_REVIEWER_STATUSES = [
  'active',
  'suspended',
] as const satisfies readonly ReviewerStatus[];

export type ManageableReviewerStatus = (typeof MANAGEABLE_REVIEWER_STATUSES)[number];

export const MIN_PASSWORD_LENGTH = 8;

/**
 * Digits with an optional leading `+`, 7-15 digits (E.164's ceiling).
 * Deliberately not normalised: login matches `users.phone` exactly, and the
 * candidate registration path doesn't normalise either, so `0803...` and
 * `+234803...` are different identifiers until both paths change together.
 */
const PHONE_PATTERN = /^\+?[0-9]{7,15}$/;

/** One `@`, something on both sides. Shape only — not deliverability. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/;

/** Roles whose work arrives through the subject-filtered review queue. */
const SUBJECT_SCOPED_ROLES: readonly AssignableReviewerRole[] = ['reviewer', 'moderator'];

export interface CreateReviewerAccountInput {
  fullName: string;
  phone: string;
  email: string;
  role: AssignableReviewerRole;
  subjectIds: number[];
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

export interface SubjectSummary {
  id: number;
  name: string;
}

export interface ReviewerAccountSummary {
  reviewerId: number;
  fullName: string;
  phone: string;
  /** Nullable: accounts provisioned before this flow existed may have none. */
  email: string | null;
  role: PanelRole;
  status: ReviewerStatus;
  subjects: SubjectSummary[];
  mustChangePassword: boolean;
  createdAt: string;
}

/**
 * `temporaryPassword` is returned exactly once, to the content lead who
 * created or reset the account, and is never stored in plain text. The
 * reviewer is forced to replace it on first login.
 */
export type CreateReviewerAccountOutcome =
  | { ok: true; reviewerId: number; temporaryPassword: string }
  | { ok: false; reason: 'phone_taken' | 'email_taken' | 'unknown_subject' };

export type ResetReviewerPasswordOutcome =
  | { ok: true; temporaryPassword: string }
  | { ok: false; reason: 'not_found' | 'not_manageable' };

export type SetReviewerStatusOutcome =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'not_manageable' };

export type ChangePasswordOutcome = { ok: true } | { ok: false; reason: 'wrong_current_password' };

/** What `apps/api`'s reviewer-accounts routes need from the database. */
export interface ReviewerAccountService {
  listAccounts(): Promise<ReviewerAccountSummary[]>;
  listSubjects(): Promise<SubjectSummary[]>;
  createAccount(input: CreateReviewerAccountInput): Promise<CreateReviewerAccountOutcome>;
  resetPassword(reviewerId: number): Promise<ResetReviewerPasswordOutcome>;
  setStatus(reviewerId: number, status: ManageableReviewerStatus): Promise<SetReviewerStatusOutcome>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function includes<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value);
}

function requireTrimmedString(raw: Record<string, unknown>, field: string): string {
  const value = raw[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string, got ${JSON.stringify(value)}`);
  }
  return value.trim();
}

/** The `POST /content-lead/reviewers` boundary validator. */
export function parseCreateReviewerAccountInput(raw: unknown): CreateReviewerAccountInput {
  if (!isPlainObject(raw)) {
    throw new Error(`create-reviewer input must be an object, got ${JSON.stringify(raw)}`);
  }

  const fullName = requireTrimmedString(raw, 'fullName');

  const phone = requireTrimmedString(raw, 'phone');
  if (!PHONE_PATTERN.test(phone)) {
    throw new Error(
      `phone must be 7-15 digits with an optional leading +, got ${JSON.stringify(phone)}`,
    );
  }

  const email = requireTrimmedString(raw, 'email');
  if (!EMAIL_PATTERN.test(email)) {
    throw new Error(`email must be an email address, got ${JSON.stringify(email)}`);
  }

  if (!includes(ASSIGNABLE_REVIEWER_ROLES, raw.role)) {
    throw new Error(
      `role must be one of ${ASSIGNABLE_REVIEWER_ROLES.join(', ')}, got ${JSON.stringify(raw.role)}`,
    );
  }
  const role = raw.role;

  const subjectIds = raw.subjectIds;
  if (
    !Array.isArray(subjectIds) ||
    !subjectIds.every((id): id is number => Number.isInteger(id) && (id as number) > 0)
  ) {
    throw new Error(
      `subjectIds must be an array of positive integers, got ${JSON.stringify(subjectIds)}`,
    );
  }
  if (new Set(subjectIds).size !== subjectIds.length) {
    throw new Error(`subjectIds must not contain duplicates, got ${JSON.stringify(subjectIds)}`);
  }
  if (subjectIds.length === 0 && SUBJECT_SCOPED_ROLES.includes(role)) {
    throw new Error(
      `subjectIds must name at least one subject for a ${role} — their queue is filtered by subject`,
    );
  }

  return { fullName, phone, email, role, subjectIds: [...subjectIds] };
}

/**
 * The `POST /review/change-password` boundary validator. Neither password is
 * trimmed (a space is a legitimate character) and neither is ever echoed
 * into a thrown message, matching `parseLoginInput`.
 */
export function parseChangePasswordInput(raw: unknown): ChangePasswordInput {
  if (!isPlainObject(raw)) {
    throw new Error('change-password input must be an object');
  }

  const { currentPassword, newPassword } = raw;
  if (typeof currentPassword !== 'string' || currentPassword.length === 0) {
    throw new Error('currentPassword must be a non-empty string');
  }
  if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`newPassword must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (newPassword === currentPassword) {
    throw new Error('newPassword must differ from currentPassword');
  }

  return { currentPassword, newPassword };
}

/** The `POST /content-lead/reviewers/:id/status` boundary validator. */
export function parseReviewerStatusInput(raw: unknown): { status: ManageableReviewerStatus } {
  if (!isPlainObject(raw)) {
    throw new Error(`status input must be an object, got ${JSON.stringify(raw)}`);
  }
  if (!includes(MANAGEABLE_REVIEWER_STATUSES, raw.status)) {
    throw new Error(
      `status must be one of ${MANAGEABLE_REVIEWER_STATUSES.join(', ')}, got ${JSON.stringify(raw.status)}`,
    );
  }
  return { status: raw.status };
}

/**
 * Whether a content lead may reset the password of, or suspend/reactivate,
 * an existing account. Checked against the row's current values inside the
 * same transaction that changes it.
 */
export function isManageableAccount(account: { role: string; status: string }): boolean {
  return (
    includes(ASSIGNABLE_REVIEWER_ROLES, account.role) &&
    includes(MANAGEABLE_REVIEWER_STATUSES, account.status)
  );
}
