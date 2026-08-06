import { describe, expect, it } from 'vitest';

// Requires a live Postgres (DATABASE_URL). Skipped automatically where it
// isn't set (e.g. CI has no Postgres service yet), rather than failing the
// suite. `client.ts` and `migrate.ts` are imported dynamically, inside the
// guarded test body, so the module-level "DATABASE_URL is not set" throw in
// client.ts never fires when this suite is skipped.
const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.runIf(hasDatabase)('runMigrationSql', () => {
  it('rolls back every statement in the file when a later statement fails', async () => {
    const { pool } = await import('./client');
    const { runMigrationSql } = await import('./migrate');

    await pool.query('DROP TABLE IF EXISTS rollback_probe');

    await expect(
      runMigrationSql(`
        CREATE TABLE rollback_probe (id INT);
        INSERT INTO rollback_probe (id) VALUES (1);
        SELECT this_column_does_not_exist FROM rollback_probe;
      `),
    ).rejects.toThrow();

    const result = await pool.query<{ exists: string | null }>(
      "SELECT to_regclass('public.rollback_probe')::text AS exists",
    );
    expect(result.rows[0]?.exists).toBeNull();

    await pool.end();
  });
});
