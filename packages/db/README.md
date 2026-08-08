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
- The syllabus hierarchy (`subjects` → `topics` → `subtopics` → `objectives`)
  is four real tables, never free text.
- `exam_configs` holds the exam blueprint as versioned data, not
  hard-coded application logic.
- The seed script is idempotent (`ON CONFLICT` on natural keys) — rerunning
  it does not duplicate rows.

## Bigint ids are parsed to JavaScript numbers

This is a **package-wide decision**, not a detail of any one query, and it
affects every consumer of `@jamb/db`.

`client.ts` registers `types.setTypeParser(types.builtins.INT8, Number)`.
Without it, `pg` returns every `int8` — which is every `BIGSERIAL` id in
this schema, plus `count(*)` — as a **string**, because a Postgres bigint
can exceed what a JavaScript number represents exactly. That default had
quietly made every `id: number` in this package a lie: nothing noticed,
because both sides of every comparison happened to be strings. It surfaced
only when a test asserted `typeof id === 'number'` rather than equality.

**The bound is 2^53** (9,007,199,254,740,992). Above it, ids silently lose
precision — two different rows can parse to the same number, which is worse
than the string default because it fails as wrong answers rather than as
type errors. Every id here is a surrogate key on a table that will not
approach that scale, so parsing is safe and makes the declared types
honest.

**Revisit this if** a table ever stores a genuinely large `int8` — an
externally-issued identifier, a monetary amount in minor units, an
accumulating event counter. Such a column needs its own parser returning a
string or `BigInt`, and a type to match; do not rely on the package-wide
default covering it.

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
_records_ that the item was released, via the `claim_expired` transition,
and the state machine decides whether it lands back in `pending_review` or
`needs_second_review`.

**`items.gate_flagged` is written only by `flagForJudgement`,** in the same
transaction as the `routed_for_judgement` transition. It denormalises what
the transition log already implies, so the moment the two can be written
apart is the moment they can disagree — and the queue would then prioritise
on a fact the audit trail contradicts. An integration test asserts the two
describe exactly the same set of items.

**A gold stock-out is counted, not swallowed.** When the injection draw
fires and no eligible gold item exists, `review_queue_gold_stockouts` gets a
row before the fallback to an ordinary item. Running dry is otherwise
completely silent — the reviewer sees a normal item, the request succeeds,
and accuracy measurement simply stops. The count is per reviewer so the
dashboard can distinguish "the seeded stock is exhausted" from "this
reviewer has already seen every gold item in their subjects".

**The queue tests commit and then TRUNCATE.** The concurrency test needs
twenty connections to see the same items, which rules out the roll-back-a-
transaction pattern the other integration tests use. TRUNCATE is also the
only way to clear the append-only tables: their DELETE triggers reject a
DELETE, but TRUNCATE fires TRUNCATE triggers, not row triggers. Because
these tests wipe shared tables, `vitest.config.ts` sets
`fileParallelism: false` for this package.

## Review decisions (`review-decision-repository.ts`)

`submitBlindAnswer`, `revealItem`, `decideOnItem` — the three calls behind
the anti-anchoring control (7.10). All three require the caller to
currently hold a live claim on the item; none of them make sense otherwise.

**Expected outcomes are discriminated results, not exceptions.** "Not your
claim", "already answered", "not yet solved" and an invalid state
transition are all ordinary business outcomes — the same reasoning
`getNextItem` already applied by returning `null` for "nothing available"
rather than throwing. The router maps each `reason` to a status code (403,
409); only a genuine invariant violation reaches Express's default handler.

**`submitBlindAnswer` is one guarded `UPDATE`, not read-then-write.**
`... WHERE reviewer_answer IS NULL RETURNING item_id` either records the
answer or touches nothing; a zero-row result triggers one follow-up `SELECT`
to report _why_ (never claimed vs. already answered), but the answer itself
is never at risk of a lost update between two near-simultaneous submissions.

**The immutability trigger's reachable branch, and the one that isn't.**
Migration 0014's `forbid_reviewer_answer_rewrite` blocks a same-episode
rewrite (`claimed_at` unchanged) — this is the one a reviewer can actually
trigger, by calling `/solve` twice. `submitBlindAnswer`'s own `WHERE
reviewer_answer IS NULL` guard means the application's second call never
even reaches the trigger; the trigger is verified directly against raw SQL
in the integration test, the same way an append-only guard is.

The reclaim path's `reviewer_answer = NULL` reset, by contrast, guards a
branch (`claimItems`' `ON CONFLICT DO UPDATE`) that is **not reachable
through the application today** — `lockCandidates` gates candidacy on
`items.status`, and the only path that restores a candidate status after an
expiry (`releaseExpiredClaims`) also deletes the conflicting row in the same
step, so a real reclaim is always a fresh `INSERT`. The reset stays as
defense in depth against a future change to either of those two facts, and
is tested directly against a hand-constructed row conflict, since the
application has no way to construct one itself. See
`review-decision.integration.test.ts` for both.

**`decideOnItem` computes `seconds_taken` server-side**, from the claim's
`claimed_at` to the moment of decision, rather than trusting a client-
supplied duration — the same instinct as "server is scoring authority"
(CLAUDE.md rule 5) applied to review timing.

**`recordTransition` now writes `approval_route`.** It always accepted the
column existed but never populated it, because before this module no
transition it recorded ever produced a non-null route — `claimed` and
`claim_expired` are always null, and `flagForJudgement`'s
`routed_for_judgement` is too. `reviewer_decided` is the first event that
can establish `human_reviewed`, which is what surfaced the gap. Fixed at
the shared function, not by adding a special case for one call site.

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
