import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  APPROVAL_ROUTES,
  GOLD_REFERENCE_DECISIONS,
  INDEPENDENT_SOLVE_VERDICTS,
  ITEM_STATUSES,
  OPTION_LABELS,
  PANEL_ROLES,
  REJECTION_REASONS,
  REVIEWER_STATUSES,
  REVIEW_ACTIONS,
  RISK_TIERS,
} from '@jamb/shared';
import { migrationsDir } from './migrations';

/**
 * packages/shared/src/item-lifecycle.ts is the single home for the item
 * lifecycle vocabulary, but the database enforces the same values in CHECK
 * constraints, which TypeScript cannot see. This test reads the migrations
 * and fails if the two ever drift apart — so adding a state to one place
 * without the other is a red build, not a runtime surprise months later.
 */
function readMigration(name: string): string {
  return readFileSync(path.join(migrationsDir, `${name}.up.sql`), 'utf8');
}

/**
 * Pulls the values out of a `<column> IN ('a', 'b', ...)` CHECK. The
 * lookbehind stops `status` from also matching `from_status`, and the
 * value lists contain no parentheses of their own.
 */
function checkConstraintValues(sql: string, column: string): string[] {
  const pattern = new RegExp(`(?<![\\w])${column} IN \\(([^)]*)\\)`, 'g');
  const matches = [...sql.matchAll(pattern)];

  expect(
    matches.length,
    `expected exactly one CHECK constraint on '${column}' in this migration`,
  ).toBe(1);

  const values = matches[0]?.[1] ?? '';
  return [...values.matchAll(/'([^']*)'/g)].map((match) => match[1] ?? '');
}

const items = readMigration('0005_items');
const reviewWorkflow = readMigration('0012_item_review_workflow');

describe('the database vocabulary matches packages/shared', () => {
  it.each([
    ['items.status', items, 'status', ITEM_STATUSES],
    ['items.approval_route', items, 'approval_route', APPROVAL_ROUTES],
    ['item_options.label', items, 'label', OPTION_LABELS],
    ['items.risk_tier', reviewWorkflow, 'risk_tier', RISK_TIERS],
    [
      'items.independent_solve_verdict',
      reviewWorkflow,
      'independent_solve_verdict',
      INDEPENDENT_SOLVE_VERDICTS,
    ],
    ['reviewers.role', reviewWorkflow, 'role', PANEL_ROLES],
    ['reviewers.status', reviewWorkflow, 'status', REVIEWER_STATUSES],
    ['review_decisions.action', reviewWorkflow, 'action', REVIEW_ACTIONS],
    ['review_decisions.rejection_reason', reviewWorkflow, 'rejection_reason', REJECTION_REASONS],
    ['review_decisions.reviewer_answer', reviewWorkflow, 'reviewer_answer', OPTION_LABELS],
    [
      'gold_items.reference_decision',
      reviewWorkflow,
      'reference_decision',
      GOLD_REFERENCE_DECISIONS,
    ],
    ['gold_items.reference_key', reviewWorkflow, 'reference_key', OPTION_LABELS],
    ['gold_items.planted_error_type', reviewWorkflow, 'planted_error_type', REJECTION_REASONS],
    ['item_state_transitions.from_status', reviewWorkflow, 'from_status', ITEM_STATUSES],
    ['item_state_transitions.to_status', reviewWorkflow, 'to_status', ITEM_STATUSES],
  ])('%s holds exactly the shared values', (_label, sql, column, expected) => {
    expect(checkConstraintValues(sql, column)).toEqual([...expected]);
  });

  it('allows every panel role plus system as a transition actor', () => {
    // The transition log accepts one value the panel roles do not contain:
    // the automated pipeline, which acts without a user id.
    expect(checkConstraintValues(reviewWorkflow, 'actor_role')).toEqual(['system', ...PANEL_ROLES]);
  });

  it('carries the approval routes on the transition log too', () => {
    // approval_route appears once per migration, so this is read separately
    // from the items.approval_route assertion above.
    expect(checkConstraintValues(reviewWorkflow, 'approval_route')).toEqual([...APPROVAL_ROUTES]);
  });
});
