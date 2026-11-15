import { Pool } from 'pg';
import { syncApprovedItems } from './sync';

/**
 * `pnpm sync-to-production` — pushes every currently-approved local item
 * to the production database. Two independent `pg.Pool`s, never
 * `@jamb/db`'s own singleton `pool` for the target side: that pool is
 * bound to a single `DATABASE_URL` at import time (`@jamb/db/src/client.ts`),
 * which can only ever represent one of the two databases this script
 * talks to. `sync.ts`'s core logic takes two already-connected
 * `PoolClient`s instead, exactly like every other `@jamb/db` repository
 * function already does.
 *
 * `DATABASE_URL` must still be set (same value as the source) even though
 * this file never reads it directly — `sync.ts`'s `import { ... } from
 * '@jamb/db'` triggers `@jamb/db/src/client.ts`'s own eager, import-time
 * `DATABASE_URL`-must-be-set check (the same constraint `tools/item-gen`'s
 * `cli.ts` already lives with), which runs before `main()` below ever gets
 * a chance to read `SOURCE_DATABASE_URL`'s fallback. Confirmed for real:
 * omitting it fails immediately with "DATABASE_URL is not set" even
 * though `SOURCE_DATABASE_URL` was set. `SOURCE_DATABASE_URL` itself
 * defaults to `DATABASE_URL` only for *this* script's own two-pool setup
 * — only `TARGET_DATABASE_URL` (and `TARGET_PGSSL=true` for a hosted
 * target) are genuinely new configuration.
 */

function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`sync-to-production: ${name} is not set`);
  }
  return value;
}

async function main(): Promise<void> {
  const sourceConnectionString = requireEnv('SOURCE_DATABASE_URL', process.env.DATABASE_URL);
  const targetConnectionString = requireEnv('TARGET_DATABASE_URL');
  const targetSsl = process.env.TARGET_PGSSL === 'true' ? { rejectUnauthorized: false } : undefined;

  const sourcePool = new Pool({ connectionString: sourceConnectionString });
  const targetPool = new Pool({ connectionString: targetConnectionString, ssl: targetSsl });

  const sourceClient = await sourcePool.connect();
  const targetClient = await targetPool.connect();
  try {
    const result = await syncApprovedItems({
      source: sourceClient,
      target: targetClient,
      now: () => new Date(),
    });

    console.log(
      result.syncedLocalItemIds.length === 0
        ? 'No approved items to sync.'
        : `Synced ${result.syncedLocalItemIds.length} approved item(s): ${result.syncedLocalItemIds.join(', ')}`,
    );
  } finally {
    sourceClient.release();
    targetClient.release();
    await sourcePool.end();
    await targetPool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
