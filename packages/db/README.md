# @jamb/db

PostgreSQL migrations, a migration runner, and the seed script, implementing
the core data model from `docs/implementation-plan.md` section 8.4 and the
item metadata schema from section 7.6.

## Local setup

```
docker compose up -d db
cp .env.example .env   # then export DATABASE_URL from it, or set it yourself
```

`DATABASE_URL` must be set in the environment before running any command
below — this package does not load `.env` files for you.

## Commands

```
pnpm --filter @jamb/db migrate:up          # apply every pending migration
pnpm --filter @jamb/db migrate:down        # revert the most recent migration
pnpm --filter @jamb/db migrate:down --all  # revert every applied migration
pnpm --filter @jamb/db seed                # load the 2026 exam config + docs/jamb-seed-items.json
```

Migrations live in `migrations/` as paired `NNNN_name.up.sql` /
`NNNN_name.down.sql` files, applied in filename order and tracked in a
`schema_migrations` table. Every migration must be reversible.

## Notes

- `attempts` is append-only: a trigger rejects any `UPDATE` or `DELETE`
  against it (migration `0008_attempts`), proven by
  `attempts-guard.integration.test.ts`.
- The syllabus hierarchy (`subjects` → `topics` → `subtopics` → `objectives`)
  is four real tables, never free text.
- `exam_configs` holds the exam blueprint as versioned data, not
  hard-coded application logic.
- The seed script is idempotent (`ON CONFLICT` on natural keys) — rerunning
  it does not duplicate rows.

## Why a bespoke migration runner, not node-pg-migrate

`src/migrate.ts` is a ~90-line runner (`up` / `down [--all]`) instead of an
established migration framework. Reasoning:

- Zero dependency surface beyond `pg` itself, which any DB access needs
  regardless. No framework DSL, no migration-file conventions beyond plain
  paired `.up.sql` / `.down.sql` files — matches "write PostgreSQL
  migrations" literally.
- Each migration file runs inside one transaction; a failing statement rolls
  back the whole file. This isn't just asserted — it's proven by
  `migrate.integration.test.ts`, which runs a real failing multi-statement
  batch against Postgres and checks nothing partial survives.
- Small enough that the entire runner is readable in one sitting, which
  matters more than feature completeness at this stage.

**This decision is not permanent.** Swap to `node-pg-migrate` the moment
either of these becomes true:

1. **A second contributor runs migrations.** The bespoke runner has no
   advisory lock against two people (or two CI runs) applying migrations
   concurrently — `node-pg-migrate` does. One person, one machine, is the
   only regime this runner is safe in.
2. **There is any production data.** The runner has no checksum or drift
   detection if an already-applied migration file gets hand-edited after the
   fact. That's an acceptable risk against an empty or seed-only local
   database; it is not an acceptable risk once real candidate data exists.

Either condition alone is sufficient to trigger the swap — don't wait for
both.
