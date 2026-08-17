import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BRIEF_STATUSES } from '@jamb/shared';
import { migrationsDir } from './migrations';

/**
 * Sibling to lifecycle-vocabulary.test.ts, same technique: reads the
 * migration and fails if its CHECK constraint drifts from
 * packages/shared/src/brief-lifecycle.ts.
 */
function readMigration(name: string): string {
  return readFileSync(path.join(migrationsDir, `${name}.up.sql`), 'utf8');
}

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

const contributorBriefs = readMigration('0021_contributor_briefs');

describe('the database brief vocabulary matches packages/shared', () => {
  it('briefs.status holds exactly the shared values', () => {
    expect(checkConstraintValues(contributorBriefs, 'status')).toEqual([...BRIEF_STATUSES]);
  });
});
