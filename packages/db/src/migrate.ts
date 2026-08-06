import { readFileSync } from 'node:fs';
import { pool } from './client';
import { loadMigrations } from './migrations';

async function ensureMigrationsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function appliedMigrationNames(): Promise<Set<string>> {
  const result = await pool.query<{ name: string }>('SELECT name FROM schema_migrations');
  return new Set(result.rows.map((row) => row.name));
}

async function runSqlFile(filePath: string): Promise<void> {
  const sql = readFileSync(filePath, 'utf8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function up(): Promise<void> {
  await ensureMigrationsTable();
  const applied = await appliedMigrationNames();

  for (const migration of loadMigrations()) {
    if (applied.has(migration.name)) continue;

    console.log(`applying ${migration.name}`);
    await runSqlFile(migration.upPath);
    await pool.query('INSERT INTO schema_migrations (name) VALUES ($1)', [migration.name]);
  }
}

async function down(all: boolean): Promise<void> {
  await ensureMigrationsTable();
  const applied = await appliedMigrationNames();

  const appliedInOrder = loadMigrations()
    .filter((migration) => applied.has(migration.name))
    .reverse();

  const toRevert = all ? appliedInOrder : appliedInOrder.slice(0, 1);

  for (const migration of toRevert) {
    console.log(`reverting ${migration.name}`);
    await runSqlFile(migration.downPath);
    await pool.query('DELETE FROM schema_migrations WHERE name = $1', [migration.name]);
  }
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  if (command === 'up') {
    await up();
  } else if (command === 'down') {
    await down(rest.includes('--all'));
  } else {
    throw new Error(`unknown command "${command}" — use "up" or "down [--all]"`);
  }

  await pool.end();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
