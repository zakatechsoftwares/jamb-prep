import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ILLUSTRATION_TICKET_STATUSES } from '@jamb/shared';
import { migrationsDir } from './migrations';

/**
 * Sibling to brief-lifecycle-vocabulary.test.ts, same technique: reads the
 * migration and fails if its CHECK constraint drifts from
 * packages/shared/src/illustration-lifecycle.ts.
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

const illustrationTickets = readMigration('0022_illustration_tickets');

describe('the database illustration ticket vocabulary matches packages/shared', () => {
  it('illustration_tickets.status holds exactly the shared values', () => {
    expect(checkConstraintValues(illustrationTickets, 'status')).toEqual([
      ...ILLUSTRATION_TICKET_STATUSES,
    ]);
  });
});
