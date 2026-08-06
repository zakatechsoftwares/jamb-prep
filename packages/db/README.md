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
  against it (migration `0008_attempts`).
- The syllabus hierarchy (`subjects` → `topics` → `subtopics` → `objectives`)
  is four real tables, never free text.
- `exam_configs` holds the exam blueprint as versioned data, not
  hard-coded application logic.
- The seed script is idempotent (`ON CONFLICT` on natural keys) — rerunning
  it does not duplicate rows.
