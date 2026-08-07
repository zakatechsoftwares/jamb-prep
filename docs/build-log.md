# Build log

Chronological record of what's been built, what's open, and what's next.
Newest entry at the bottom.

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

## Session 03 — scoring (2026-08-07, `session/03-scoring`, PR open against `main`)

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
