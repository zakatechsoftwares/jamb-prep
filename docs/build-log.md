# Build log

Chronological record of what's been built, what's open, and what's next.
Newest entry at the bottom.

## BLOCKING

Items here gate other work. They are not "open notes" to be carried
forward — nothing that depends on them may ship until they are resolved.

### B1 — No authentication on the reviewer endpoints (opened session 05)

`GET /review/next` and `GET /review/next-batch` take `reviewerId` as a
**query parameter**. Any caller can therefore request any reviewer's queue
and claim items as them, which also means they can write
`review_decisions` and `item_state_transitions` rows attributed to somebody
else — into append-only tables, where a false attribution cannot be
corrected, only annotated.

**The rule: `reviewerId` comes from an authenticated session, never from
the request. No reviewer-facing endpoint ships without it.**

**Blocks Session D.** A client built against the current signature would
encode "the caller names the reviewer" in its request layer, its offline
cache keys and its sync payloads. That is expensive to unpick afterwards,
and it is exactly the kind of shape that survives a rewrite. Resolve this
before Session D builds anything against these routes.

Resolving it means: the reviewer identity is derived server-side from the
session, `reviewerId` disappears from the query string, and a test asserts
that a request naming a different reviewer than the authenticated one is
rejected rather than honoured.

## Session 01 — scaffold (2026-08-06, `session/01-scaffold`, PR #2, merged)

**Built:**

- pnpm workspace scaffold: `apps/admin` (Next.js), `apps/api` (Express),
  `apps/mobile` (Expo, with a react-native stub so its tests can run under
  vitest), `packages/shared`, root eslint/prettier/tsconfig, CI workflow
- `tools/` added as a workspace member, with a README noting
  `docx-to-md.py` as a one-off import tool
- CLAUDE.md rule: no business logic in `apps/mobile`
- Node engine requirement bumped to `>=22`; CI action majors bumped to match

**Open at close:** none blocking — scaffold merged clean.

**Next:** implement the database schema (session 02).

## Session 02 — schema (2026-08-06, `session/02-schema`, PR #3, merged)

**Built:**

- `@jamb/db`: 11 migrations covering every entity in plan section 8.4
  (syllabus hierarchy, subject combinations, users, passages, items with
  the full 7.6 metadata schema, exam configs, sessions, attempts,
  mastery/spaced-repetition, institutions/cohorts, commercial entities)
- A custom migration runner (`up` / `down [--all]`), transactional per
  file, proven by an integration test that a failing statement rolls back
  the whole migration
- An idempotent seed script loading the 2026 exam config and
  `docs/jamb-seed-items.json`
- `attempts` append-only guard (DB trigger rejecting `UPDATE`/`DELETE`),
  proven by an integration test, not just a manual check
- `docker-compose.yml` + `.env.example` for local Postgres
- CI: added a `postgres:16` service so both integration tests actually run
  in CI instead of skipping
- `docs/implementation-plan.md` §7.4: added distractor-rationale
  completeness as an explicit automated gate
- `packages/db/README.md`: documents why the migration runner is bespoke
  (not `node-pg-migrate`) and the two conditions that trigger a swap — a
  second contributor running migrations, or any production data

**Open at close:** none blocking — both PRs merged into `main` the same
day.

**Next:** the scoring engine (session 03).

## Session 03 — scoring (2026-08-07, `session/03-scoring`, PR #4, merged)

**Built:**

- `packages/shared/src/scoring.ts`: a pure, dependency-free
  `scoreExam(config, attempts)` returning per-subject scores and an
  aggregate. All item counts and marks are read from `ExamConfig`, never
  hard-coded.
- No `negativeMarking` field on `ExamConfig` — removed by design rather
  than left unread; "no negative marking" is a fixed invariant of the
  algorithm, documented as such in `packages/shared/README.md`.
- Attempts are append-only (CLAUDE.md rule 2), so `scoreExam` resolves the
  latest attempt per item via a `sequence` field that must be unique per
  item. A duplicate sequence anywhere in an item's history throws — caught
  even when the collision isn't against the current running maximum
  (`[5, 7, 5]` throws on the second 5).
- `scoreExam` throws, rather than silently tolerating, on: an attempt
  referencing a subject outside the config (including a stale/superseded
  row for an otherwise-valid item), more distinct items for a subject than
  its `itemsPerSubject` allows, and a config whose `totalMarks` doesn't
  equal the sum of `marksPerSubject` across its subjects.
- Rounding rule: half up, per subject; the aggregate is the sum of the
  already-rounded subject scores. Documented in
  `packages/shared/README.md`, explicitly flagged as pending verification
  against a real UTME result slip — a design decision, not a value taken
  from the plan.
- 16 unit tests, written before the implementation and shown for review
  across three rounds before any code was written (tests red → reviewed →
  implementation → green).

**Open at close:**

- The rounding rule (half up, per subject) has not been verified against
  an actual UTME result slip.
- `scoreExam` takes an already-resolved, per-subject `ExamConfig` (a flat
  `{ subjectId, itemsPerSubject, marksPerSubject }[]`). Resolving a real
  candidate's 4 actual subjects from `exam_config_subject_rules` (role-based:
  compulsory/elective) plus their `subject_combination` is a join this
  module deliberately does not do — that belongs to a future repository
  layer, not the pure scoring function.
- No repository layer yet connects `packages/db`'s `attempts` table to
  `scoreExam`'s `ScoringAttempt` shape — in particular, mapping `sequence`
  from `attempts.created_at`/`id` ordering as documented in
  `packages/shared/README.md` is not yet implemented anywhere.

**Next:** the repository layer / `apps/api` routes that assemble an
`ExamConfig` and `ScoringAttempt[]` from the database and call
`scoreExam`; a session-sync / idempotent attempt-submission endpoint.

## Session 04 — item lifecycle state machine (2026-08-08, `session/04-state-machine`, PR #5, merged)

**Built:**

- `packages/shared/src/item-lifecycle.ts`: the single home for the item
  lifecycle vocabulary — the 11 states, approval routes, risk tiers,
  independent-solve verdicts, review actions, the structured rejection
  taxonomy, panel roles, reviewer statuses. No package retypes these.
- `packages/shared/src/item-state-machine.ts`: pure
  `transition(state, event, context)` implementing plan 7.10. Throws on
  any illegal transition rather than returning a falsy result. Legal
  transitions live in one table of source states per event; `rejected` and
  `retired` are terminal by appearing in no list.
- Migration `0012`: completed the items lifecycle metadata
  (`independent_solve_verdict` gained `not_run` and became NOT NULL,
  `risk_tier` gained `not_generated`, plus `contributor_id` and
  `sampled_for_review`), and added `reviewers`, `reviewer_subjects`,
  `review_decisions`, `review_claims`, `gold_items`, `moderator_audits`
  and `item_state_transitions`.
- `review_decisions` and `item_state_transitions` are append-only, guarded
  by triggers, following the `attempts` pattern from `0008`.
- `lifecycle-vocabulary.test.ts`: parses the migrations' CHECK constraints
  and fails if they drift from the shared constants. `@jamb/db` took a
  workspace dependency on `@jamb/shared` to make this possible.
- 217 state machine tests: every legal transition, an exhaustive sweep
  asserting the other 126 (state, event) pairs throw, and each guard with
  a test asserting it throws.

**Decisions worth remembering:**

- `gates_passed` never promotes. It queues everything as `pending_review`;
  the automated route in 7.14 is reached only through `auto_gate_promote`,
  which asserts all three conditions and throws. Skipping human review is
  a deliberate act, not something a caller can fall into.
- `transition` returns `{ status, approvalRoute, actorUserId, occurredAt }`
  rather than a bare state, so the approval route is derived in exactly one
  place and the audit row is a direct product of the transition.
- An expired claim returns to `needs_second_review` when a prior decision
  exists, so a lapsed second review cannot be approved by one reviewer.
- CLAUDE.md's push rule was narrowed to pull requests, resolving a
  contradiction with the stop hook.

**Open at close:** `item_state_transitions` had no writer — the machine
returned the row's contents but nothing persisted it. (Closed in session
05.)

## Session 05 — reviewer queue (2026-08-08, `session/05-queue`, PR against `main`)

**Built:**

- `packages/shared/src/review-queue-policy.ts`: the pure half of the queue
  (plan 7.9, 7.11) — `priorityOf`, `requiresHumanReview`,
  `isEligibleForReviewer`, `compareQueueEntries`, `shouldServeGoldItem`,
  `shouldSampleForReview`, `validateReviewQueueConfig`. 55 tests.
- `packages/db/src/review-queue-repository.ts`: `getNextItem`,
  `getNextItemBatch`, `releaseExpiredClaims`, `flagForJudgement`,
  `goldStockoutsSince`. Serving and claiming happen in one transaction,
  with candidates locked by `SELECT ... FOR UPDATE OF i SKIP LOCKED`.
- Migration `0013`: `review_queue_configs` (versioned, one active row),
  `items.gate_flagged`, `review_queue_gold_stockouts`, and indexes for the
  queue scan, the reviewer-exclusion check and the claim sweep.
- `apps/api`: `GET /review/next` and `GET /review/next-batch`. No list,
  filter or search route exists, deliberately. The queue service is
  injected and the DTO lives in `@jamb/shared`, so importing the app in a
  test never opens a database connection.
- 33 queue integration tests including 20 concurrent `getNextItem` calls
  returning 20 distinct items, plus a ranking drift test driving all 396
  combinations of item facts through both the SQL and the shared policy.

**Decisions worth remembering:**

- Filtering the queue on the sampling draw alone was wrong, and was caught
  while writing the tests: it would have dropped low-risk unsampled items
  whose independent solve disagreed — the priority-1 band, the single
  highest-value signal the pipeline produces. `requiresHumanReview` is the
  negated 7.14 triple, with gate-flagged and second-review items queueable
  regardless. The triple itself is now `qualifiesForAutomatedRoute`, read
  by both the state machine and the queue.
- Ordering is band, then `created_at`, then id. The age tiebreak stops the
  ordinary band starving during a generation wave; the id tiebreak makes
  the order total.
- Gold items take the same exclusions as ordinary ones, including "already
  decided by this reviewer" — otherwise one judgement is counted twice in
  the accuracy score.
- Plan 7.9 gained an explicit sixth case: human-authored contributions
  queue in band 5, behind suspected errors.
- `items.gate_flagged` is written only in the same transaction as the
  `routed_for_judgement` transition, so the flag cannot contradict the log.

**Bug found and fixed:** `pg` returns `int8` as a string, so every
`id: number` in `@jamb/db` was a lie — latent across the whole package,
invisible because both sides of every comparison were strings. `client.ts`
now parses `int8` to a number; the 2^53 bound and when to revisit it are
documented in `packages/db/README.md`.

**Open at close:**

- `shouldSampleForReview` has no caller. The generation pipeline calls it
  when it writes `items.sampled_for_review` (session 10).
- The review payload omits the correct option entirely, per 7.10's
  blind-answer control. The endpoint that reveals the key after a reviewer
  records their own answer does not exist yet.
- `releaseExpiredClaims` has no scheduler. It is a function with tests, not
  a running background job.
- `goldStockoutsSince` has no reader; the content lead dashboard consumes
  it in session 09.
- **No authentication anywhere — see BLOCKING item B1 at the top of this
  file.** `reviewerId` is a query parameter, so any caller can request any
  reviewer's queue and claim items as them. This is not an open note to
  carry forward; it blocks Session D.

**Next:** the decision-recording endpoint (approve / edit and approve /
reject with reason / escalate), which is what makes the queue a workflow
rather than a dispenser.
