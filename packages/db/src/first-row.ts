import type { QueryResult, QueryResultRow } from 'pg';

export function firstRow<T extends QueryResultRow>(result: QueryResult<T>): T {
  const row = result.rows[0];
  if (!row) {
    throw new Error('expected at least one row back from the database');
  }
  return row;
}
