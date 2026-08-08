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

- Three tables are append-only, each guarded by triggers rejecting any
  `UPDATE` or `DELETE`: `attempts` (migration `0008_attempts`), and
  `review_decisions` and `item_state_transitions` (migration
  `0012_item_review_workflow`). Proven by
  `attempts-guard.integration.test.ts` and
  `review-decisions-guard.integration.test.ts`. A reviewer who changes
  their mind records a new decision; they never edit the old one.
- The enumerated values in the migrations' CHECK constraints — item
  states, approval routes, risk tiers, review actions, rejection reasons —
  are owned by `packages/shared/src/item-lifecycle.ts`, not by this
  package. `lifecycle-vocabulary.test.ts` parses the migration files and
  fails if the two drift apart, so adding a state in one place without the
  other is a red build rather than a runtime surprise later.
- The `review_*` tables in `0012` are the **editorial** review of items by
  the human panel. They are unrelated to `review_queue_entries`
  (`0009_mastery_and_review_queue`), which is the candidate-facing
  spaced-repetition queue. The name collision is worth remembering.
- `item_state_transitions` is the complete audit trail plan 7.10 requires.
  `review_decisions` covers only reviewer decisions, so it cannot carry
  that trail alone: gate failures, auto-gated promotion, calibration and
  automatic quarantine all move an item without a reviewer touching it.
- Reverting `0012` fails if any item has been tiered `not_generated`, since
  the earlier constraint has no such value. That is deliberate — the
  alternative is silently relabelling human-authored items as generated
  ones. Retier or retire those items first.
- `int8` is parsed to a JavaScript number in `client.ts`. Postgres returns
  bigint as a *string* by default, because it can exceed what a number holds
  exactly — which quietly made every `id: number` in this package a lie.
  Every id here is a surrogate `BIGSERIAL` well inside 2^53, so parsing is
  safe and makes the declared types true. Revisit if a table ever carries
  genuinely large int8 values.

## The reviewer queue (`review-queue-repository.ts`)

`getNextItem` / `getNextItemBatch` assign work to a reviewer; the pure
ranking and filtering policy lives in `@jamb/shared`, and
`review-queue-ranking.integration.test.ts` drives all 396 combinations of
item facts through both to prove the SQL and the policy agree.

**How two simultaneous callers stay disjoint.** `SELECT ... FOR UPDATE OF i
SKIP LOCKED` inside the same transaction that writes the claim. The claim
row alone is not enough: under READ COMMITTED a concurrent caller's snapshot
can predate the other's commit, so its `NOT EXISTS (review_claims ...)`
would not see the claim. The row lock closes that window; the claim row
provides exclusion that outlives the transaction. Both are needed, and the
isolation level must stay READ COMMITTED — under REPEATABLE READ a
`FOR UPDATE` against a concurrently updated row raises a serialization
failure instead of skipping it.

**Why `EXISTS` subqueries and not joins.** Postgres refuses `FOR UPDATE`
alongside aggregates, `DISTINCT`, `GROUP BY` or `UNION`, and locking the
nullable side of an outer join means nothing. `EXISTS` keeps `items` the
only lockable relation.

**Why the claim insert upserts.** `review_claims` is keyed on `item_id`, and
an expired claim row survives until the sweeper removes it, so a plain
`INSERT` would collide with it. The `WHERE review_claims.expires_at <=
now()` on the conflict path is what stops the upsert stealing a live claim.

**`releaseExpiredClaims` is not what makes an abandoned item available
again** — the queue query already ignores expired claims. It is what
*records* that the item was released, via the `claim_expired` transition,
and the state machine decides whether it lands back in `pending_review` or
`needs_second_review`.

**`items.gate_flagged` is written only by `flagForJudgement`,** in the same
transaction as the `routed_for_judgement` transition. It denormalises what
the transition log already implies, so the moment the two can be written
apart is the moment they can disagree — and the queue would then prioritise
on a fact the audit trail contradicts. An integration test asserts the two
describe exactly the same set of items.

**The queue tests commit and then TRUNCATE.** The concurrency test needs
twenty connections to see the same items, which rules out the roll-back-a-
transaction pattern the other integration tests use. TRUNCATE is also the
only way to clear the append-only tables: their DELETE triggers reject a
DELETE, but TRUNCATE fires TRUNCATE triggers, not row triggers. Because
these tests wipe shared tables, `vitest.config.ts` sets
`fileParallelism: false` for this package.
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
