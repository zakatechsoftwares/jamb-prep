# Build log

Chronological record of what's been built, what's open, and what's next.
Newest entry at the bottom.

## Session order

Two source documents supply session prompts, and this repo interleaves
them rather than finishing one before starting the other:

- **the playbook** — `docs/claude-code-prompt-playbook.md`. The
  candidate-facing app track. Numbers its own sessions `Session 1`
  through `Session 5`, then an unordered "Later sessions" list.
- **the reviewer workspace prompts** — `docs/reviewer-workspace-prompts.md`.
  The review-pipeline track. States plainly that it is a "Phase 1
  blocker" to be built "before bulk generation" — which is why this repo
  left the playbook after its Session 3 and has not returned to it since.
  Letters its own sessions `Session A` through `Session F`.

Neither document's own numbering is the canonical sequence for this
repo — **the table below is**. A session prompt's heading in its source
document (`Session 3`, `Session B`, …) is not the same number as this
project's session (`03`, `05`, …); read the table, not the heading, when
you need "what comes next."

| Canonical | Source document            | Heading in that document                                                                                                                                        | Status                  |
| --------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| 01        | playbook                   | Session 1 — Scaffold                                                                                                                                            | done, PR #2             |
| 02        | playbook                   | Session 2 — Data model                                                                                                                                          | done, PR #3             |
| 03        | playbook                   | Session 3 — Scoring engine (pure logic, no I/O)                                                                                                                 | done, PR #4             |
| 04        | reviewer workspace prompts | Session A — Item state machine and review domain model                                                                                                          | done, PR #5             |
| 05        | reviewer workspace prompts | Session B — Queue assignment service                                                                                                                            | done, PR #6             |
| 06        | reviewer workspace prompts | Session C — Review submission and the answer-before-key flow                                                                                                    | done, PR #7             |
| 07        | reviewer workspace prompts | Session D — The reviewer workspace UI                                                                                                                           | done, PR against `main` |
| 08        | reviewer workspace prompts | Session E — Offline layer for the workspace                                                                                                                     | done, PR against `main` |
| 09        | reviewer workspace prompts | Session F — Gold items, audit, and payment accrual                                                                                                              | done, PR against `main` |
| 10        | playbook                   | "Using Claude to generate the question bank" (the item generation pipeline, `tools/item-gen/`)                                                                  | done, PR against `main` |
| 11        | reviewer workspace prompts | "Then: the contributor brief board"                                                                                                                             | not started             |
| 12        | playbook                   | Session 4 — Mock CBT engine                                                                                                                                     | not started             |
| 13        | playbook                   | Session 5 — Offline sync                                                                                                                                        | not started             |
| 14+       | playbook                   | "Later sessions" (diagnostics rollup, adaptive engine, payments and entitlements, admin review tooling, institution portal) — no individual prompts written yet | not started             |

This resolves two forward references already sitting in the session 05
entry below, written before this table existed: "session 09" (the content
lead dashboard reading `goldStockoutsSince`) is workspace-prompts
Session F, and "session 10" (the generation pipeline calling
`shouldSampleForReview`) is the playbook's item generation pipeline —
both guessed correctly, and both now fixed by this table rather than by
memory.

**Why the playbook's own Session 4 and Session 5 are not this repo's
sessions 04 and 05.** The playbook numbers its own track independently
of the reviewer-workspace track; the two schemes only happen to overlap
in digits. This repo's actual session 04 is workspace-prompts Session A
(item state machine), and session 05 is workspace-prompts Session B
(queue assignment) — neither is the playbook's Mock CBT engine or
Offline sync, which land at canonical 12 and 13 instead, well after the
reviewer workflow finishes. The playbook's own headings for its Session 4
and Session 5 now carry a note pointing back here, so reading that file
in isolation doesn't suggest otherwise.

The playbook's own closing "review tool" prompt (the short, unlabeled one
right after the item-generation prompt) is **superseded**, not queued —
workspace-prompts' Session A through F is the same feature, specified in
far more depth, and is already done through session 06. It is not this
project's canonical session 10 or anywhere else in the table; it's dead
prompt text kept for the playbook's own narrative continuity, annotated
in place.

## BLOCKING

Items here gate other work. They are not "open notes" to be carried
forward — nothing that depends on them may ship until they are resolved.
Nothing is currently open.

### B1 — No authentication on the reviewer endpoints (opened session 05, RESOLVED session 06b)

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

**Resolved in session 06b** (`session/06b-reviewer-auth`). `reviewerId`
comes from a verified session bearer token — `resolveReviewerId` in
`apps/api/src/reviewer-identity.ts` — on every reviewer route, including
the new escalation-resolution route. There is no `reviewerId` in any
request state a caller controls, so "a request naming a different
reviewer" isn't a case that gets rejected, it's a case that cannot arise —
stronger than the original resolution criterion asked for. `POST
/review/login` issues the token. Session D is unblocked.

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

## Session 06b — reviewer authentication (2026-08-09, `session/06b-reviewer-auth`, PR against `main`)

Resolves BLOCKING item B1, opened in session 05: the five reviewer routes
(session 06's `solve` / `reveal` / `decide` plus session 05's `next` /
`next-batch`) took `reviewerId` as an unauthenticated query parameter.

**Built:**

- `packages/db`: `password_hash` on `reviewers` (migration `0015`,
  nullable — a reviewer can exist before ever being given a credential);
  `authenticateReviewer` / `setReviewerPassword`; stateless HMAC-SHA256
  session tokens (`signSessionToken` / `parseSessionToken`); `scrypt`
  password hashing — both via Node's built-in `crypto`, no new dependency.
- `ReviewerNotActiveError` moved out of `review-queue-repository.ts` into
  its own dependency-free `reviewer-errors.ts` (re-exported from there for
  existing callers), and `@jamb/db/package.json` gained an `exports` map
  exposing it and `session-tokens.ts` as standalone subpaths — so
  `apps/api` can `instanceof`-check the error and verify tokens without
  importing `@jamb/db`'s index, which opens a connection pool at load time.
- `apps/api/src/reviewer-identity.ts`: `resolveReviewerId` /
  `resolveReviewerSession` now verify a `Bearer` token instead of reading
  `req.query.reviewerId`; `requireModerator` middleware.
- `POST /review/login` (`emailOrPhone` + `password` → a signed token).
  Every failure — wrong password, unknown identifier, no password set, or
  a correctly-authenticated but inactive reviewer — returns the identical
  `401 { error: 'invalid_credentials' }`, so the response never tells a
  caller which case applied.
- `POST /review/:itemId/resolve-escalation` (session 04 guard 5: only a
  moderator rules on an `escalated` item), gated by `requireModerator`, no
  claim check. `decideOnItem` was not touched. `transition()`'s own
  moderator-only guard is exercised directly too — `requireModerator` is a
  cheap up-front gate, not the authority.
- An app-level Express error middleware maps `ReviewerNotActiveError` to
  401 for any route, reusing `loadReviewer`'s activation check (7.8) rather
  than adding a second one.
- Every existing route test switched from `?reviewerId=` to a signed
  bearer token; new tests cover 401 (missing/malformed/expired session) on
  all five original routes plus login and resolve-escalation, and 403 for
  a non-moderator on resolve-escalation.
- An end-to-end test with no fakes anywhere: seeds a reviewer and password
  against the real database, logs in over real HTTP, and uses the returned
  token as a real `Authorization` header against `GET /review/next` wired
  to the real `@jamb/db` services — proving the mechanism is usable, not
  only that its pieces typecheck in isolation.

**Decisions worth remembering:**

- `role` is a snapshot in the token, taken at login; it does not update
  until the token is re-issued. `status` (active/suspended) is deliberately
  **not** in the token — it's re-checked against the database via
  `loadReviewer` on every request, so a suspended reviewer is rejected on
  their very next request regardless of what an unexpired token claims.
  Documented on `SessionTokenPayload` itself so a later session doesn't
  assume a role change is immediate.
- A reviewer with no `password_hash` set is treated identically to a wrong
  password — never an open door, never a crash reaching `scrypt`. Tested
  directly (`reviewer-auth-repository.integration.test.ts`).
- `resolveEscalation` is `decideOnItem`'s sibling, not a mode of it: no
  claim to check, no blind answer, no idempotency key, no
  `edit_and_approve`. `parseResolveEscalationInput` only accepts
  `approve`/`reject` — `escalate` and `edit_and_approve` are refused like
  nonsense, not merely unsupported by omission.

**Open at close:**

- No self-service signup or password reset. A reviewer's password is
  provisioned out of band via `setReviewerPassword`, called directly —
  there is no route for it yet. Explicitly out of scope for this session.
- No rate limiting on `POST /review/login`.
- Session tokens cannot be revoked before they expire — there's no
  server-side session store to revoke against, by design (stateless). A
  compromised token is live until its TTL runs out.

**Next:** Session D, the reviewer workspace UI — unblocked by this
session.

## Session 07 — reviewer workspace UI (2026-08-09, `session/07-workspace-ui`, PR against `main`)

Builds `apps/admin` into the reviewer-facing app (plan 7.9): a login
screen, and a single-item review screen — no list, filter, search, or
queue browser anywhere, on desktop or mobile.

**Built:**

- `packages/db`: `getNextItem`/`getNextItemBatch` now prefer a
  reviewer's own live claim over a fresh priority-ordered assignment.
  Previously `lockCandidates`' `NOT EXISTS (review_claims ...)` filter
  excluded an item with _any_ unexpired claim, including the calling
  reviewer's own — so a reviewer re-polling while still holding an item
  (a page reload mid-review, in particular) got handed something else,
  stranding the original item in `in_review` until it naturally expired.
  New `ownLiveClaims()` query fills slots from the reviewer's own claims
  first; `lockCandidates`'s existing exclusion means the two sets can
  never overlap. No prior test proved either behavior — confirmed
  empirically (wrote the test, watched it fail against the unfixed
  query) before fixing it.
- `apps/admin/src/lib`: three pure, dependency-free modules, tested with
  no DOM — `review-flow-reducer` (the one-item state machine: loading →
  solving/deciding → choosingReason/editing → back to loading),
  `api-client` (typed fetch wrappers; every one of the five reviewer
  routes reports a uniform `unauthorized` reason on 401, `login`
  reports `invalid_credentials` instead since a 401 there means
  something different), `keyboard-shortcuts` (A-D / 1-4 / Enter / Esc →
  intent, pure key-to-intent mapping with no DOM knowledge).
- `apps/admin/src/{auth,hooks,components}`: `AuthProvider` holds the
  session token in memory only (`useState`, never `localStorage` or
  `sessionStorage` — a refresh logs the reviewer out, deliberately);
  `useReviewFlow` sequences the API calls (call reveal right after
  serving an item — `not_yet_solved` means solve-first, `ok:true` means
  straight to deciding, so the client never needs to know an item's
  `risk_tier` at all) and calls `logout()` on any unauthorized outcome;
  `useReviewFlowKeyboard` wires the pure shortcut mapping to real
  `keydown` events, suppressed inside text fields except Escape. Every
  component (`SolveStep`, `DecideStep`, `RejectionReasonPicker`,
  `InlineEditForm`, `ReviewHeader`, `LoginForm`, `EmptyQueueState`,
  `ErrorState`) tested with React Testing Library.
- Tailwind v4 with hand-rolled design tokens (48px touch targets, a
  360px-first type scale) — the session prompt referenced "the
  frontend-design skill" for design tokens; no such skill, or any
  design-tokens source, exists anywhere in this repo or the available
  skills. Flagged to the user rather than invented silently; Tailwind
  and the token choices were then explicitly approved.
- `next.config.mjs` rewrites `/api/review/*` to the real API
  server-side, so the browser only ever makes same-origin requests — no
  `cors` dependency needed on the API side. Admin's dev server moved to
  port 3001 (both it and the API default to 3000).
- `@testing-library/react`, `@testing-library/user-event`, and `jsdom`
  added to `apps/admin` as devDependencies (approved) — the package had
  zero component-testing setup beforehand (`environment: 'node'`, no
  DOM lib in `tsconfig.json` either, fixed alongside).
- 115 tests across the reducer, api-client, keyboard-shortcuts, auth,
  hooks, and every component.
- **End-to-end verification against the real running stack**, not just
  unit tests: seeded a reviewer with a password and four items (two
  low-tier, two high-tier) through the same fixtures the integration
  tests use, ran the real API and admin dev servers, and drove the
  actual browser with Playwright — a 360px touch pass (both high-tier
  items, since `risk_tier = 'high'` is queue priority 2 and always
  precedes priority 5's low-risk sampling: the touch pass never saw a
  low-tier item, and that is correct behaviour, not a gap) and a
  desktop keyboard-only pass (both low-tier items, straight to
  deciding). Confirmed: no scrolling at 360px (`scrollHeight` equalled
  viewport height exactly), the disagreement banner rendering
  prominently when the blind solve disagreed with the proposed key, all
  four actions reachable both ways, Escape cancelling the reason picker
  back to deciding, the queue draining to the empty state, and an
  unauthenticated visit to `/` redirecting straight to `/login`.

**Decisions worth remembering:**

- The client never carries a `risk_tier` field or branches on it
  anywhere. `GET /review/:itemId/reveal`'s own response — `not_yet_solved`
  vs `ok: true` — is the only signal the UI needs to choose solve-first
  vs. straight-to-deciding. One less thing for the client to get wrong
  by holding a stale copy of a server fact.
- Disagreement with the proposed key is the most visually prominent
  thing in `DecideStep`, per 7.9. `agreesWithKey` is `null` for a
  low-tier item (no blind answer was ever recorded), and the UI shows
  no agreement/disagreement indicator at all in that case, exactly
  matching `agreesWithKey()`'s contract in `@jamb/shared`.
- "Reviewed this session" is a real, live count; "accuracy" and
  "earnings" render as `—`, not a guessed number. Session F / canonical
  session 09 doesn't exist yet, and there is no honest way to compute
  either without it.
- Objective retagging (part of 7.9's "inline editing" list) is not
  offered in `InlineEditForm`. There is no endpoint to browse or search
  the objective tree — only an `objectiveId: number` on the served item
  — so building a picker for it isn't possible yet. Stem, options, key
  and explanation are all editable; objective is a known, flagged gap.

**Merge note:** this branch was built on `main`, which did not yet have
session 06b's auth work (`POST /review/login`, bearer-token gating) —
that PR was never opened. Rather than build a UI against routes that
didn't exist on this branch, `origin/session/06b-reviewer-auth` was
merged directly into `session/07-workspace-ui` (one conflict, in
`review-queue.fixtures.ts`'s `insertReviewer`/`insertReviewerWithRole` —
resolved by keeping both). Both PRs still need to land on `main`.

**Open at close:**

- No offline layer (session E / canonical 08): a reload mid-item loses
  client-side state; the server-side claim just expires normally at
  `claim_duration_minutes`. `getNextItemBatch`'s own-claim preference
  (this session) means a reviewer who reloads _before_ the claim expires
  gets the same item back rather than a fresh one, but there is still no
  local cache, no offline queue, and no resume of an in-flight solve
  answer that hadn't been submitted yet.
- No rate limiting anywhere in the login path (carried over from
  session 06b's own open item).
- Neither this PR nor session 06b's has been merged into `main` yet.

**Next:** session E, the offline layer for the workspace — or session
06b/07's PRs landing on `main` first, whichever the user prioritises.

## Session 08 — offline layer for the workspace (2026-08-09, `session/08-workspace-offline`, PR against `main`)

Makes `apps/admin` usable with no connection (plan 7.9 "offline capable",
8.3's sync design). Built on top of session 07's `api-client.ts` and
`review-flow-reducer.ts` rather than a parallel path, per the session
prompt's explicit instruction.

**Pre-check (per the session prompt):** confirmed `api-client.ts` had no
retry or queuing behaviour of any kind before this session — every method
was a single direct `fetch`, and a network failure just returned
`{ok:false, reason:'request_failed'}` and stopped.

**Built:**

- `packages/shared`: `DecisionContext = 'live' | 'late_arrival'` added to
  `DecideResult`/`DecideOutcome`/`ResolveEscalationOutcome`.
- `packages/db` migration `0016_review_decision_late_arrival`:
  `review_decisions.decision_context` (`'live'` default, partial index on
  `'late_arrival'`). `decideOnItem` gains two things in the same pass,
  since both touch the same insert path:
  - **The late-arrival branch.** When the caller holds no live claim,
    `everClaimedByReviewer()` checks `item_state_transitions` for a past
    `'claimed'` event by this reviewer (the claim row itself is
    overwritten on reassignment and proves nothing) — if they genuinely
    once held the item, the decision is recorded as an audit-only
    `decision_context: 'late_arrival'` row: no `transition()` call, no
    `items` write, no touching the current holder's claim or decision.
    A reviewer who never held the item at all is still refused.
  - **Idempotent retry.** The insert is
    `ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`; a conflict
    means this exact decision was already recorded, and the outcome
    returned is looked up fresh rather than re-derived, identical to what
    the original request got back.
- `apps/api`: `/decide`'s response now includes `decisionContext`.
- `apps/admin/src/lib/offline-store.ts` (new): IndexedDB (via
  `fake-indexeddb/auto` in tests, real in the browser) — cached items
  (with `claimExpiresAt` and, for non-high-tier items only, a prefetched
  `reveal`), a pending-decisions queue keyed by idempotency key, a
  pending-solves queue for blind answers queued offline.
- `api-client.ts`: `getNextItemBatch` wired up (the server route
  `/next-batch` already existed from session 05 but nothing on the client
  called it); `decide` takes an optional `idempotencyKey` and threads
  `decisionContext` through its outcome.
- `review-flow-reducer.ts`: `solving` gains `queued: boolean` and a new
  `blindAnswerQueued` event — the resting state for a high-tier item's
  blind answer recorded offline with nowhere to advance to until
  reconnection actually reveals it. `selectOption`/`solveSubmitted` now
  throw if dispatched once already queued.
- `useReviewFlow.ts`: the orchestrator for all of the above —
  `requestNextItem` serves from the cache when offline (oldest
  `claimExpiresAt` first); `submitSolve`/`submitDecision` queue instead of
  posting, whether genuinely offline or a live attempt failed with
  `request_failed`; a background effect (`session`/`offlineStore`/
  `isOnline` in its deps) flushes the queue then prefetches a fresh batch
  on every connect or reconnect. Returns `isOnline`, `cachedItemCount`,
  `pendingDecisionCount`, `pendingSolveCount`, `nextClaimExpiry`, and
  `lateArrivalCount` for the UI.
- `AuthProvider`: exposes `offlineStore: OfflineStore | null` (opened
  lazily and asynchronously, `null` until ready), injectable for tests
  exactly like `apiClient`.
- Service worker (`public/sw.js`, stale-while-revalidate for same-origin
  GETs, explicitly excluding `/api/*`) caches the app shell so the page
  itself loads offline; registered from a small client component
  (`ServiceWorkerRegistration`) mounted in `app/layout.tsx`. Review data
  is never routed through it — that guarantee lives entirely in
  `offline-store.ts`.
- `ReviewHeader` and `SolveStep` surface the new state: an offline badge,
  cached/pending counts, earliest claim expiry, a late-arrival count, and
  (in `SolveStep`) a "queued — will reveal once you're back online"
  notice with inputs disabled.
- `fake-indexeddb` added to `apps/admin` as a devDependency (approved).
- Tests: 60 new across `offline-store`, `api-client`, `review-flow-reducer`,
  `useReviewFlow`, `ReviewHeader`, `SolveStep`, `ServiceWorkerRegistration`
  (162 total in `apps/admin`, up from 115); 5 new in `packages/db`'s
  `review-decision.integration.test.ts` (120 total). DONE WHEN's three
  named scenarios each have a direct test: reviewing 10 items fully
  offline then reconnecting syncs all ten exactly once
  (`useReviewFlow.test.tsx`); the same decision uploaded three times
  produces exactly one row, proved at both the repository layer (direct
  `decideOnItem` calls) and the hook layer (a decision that fails once
  with `request_failed` is retried with the *same* stored idempotency
  key, never a fresh one); a decision against an expired, reassigned
  claim is retained as a `decision_context: 'late_arrival'` row, proved
  at both layers too.

**Decisions worth remembering:**

- **High-tier reveal stays online-only — no exceptions for offline.**
  The plan's answer-before-key control (7.10) is enforced at the server;
  prefetching a high-tier item's reveal into IndexedDB "just so it's
  there" would move that guarantee onto the reducer remembering not to
  render data it already has, which is a strictly weaker place for it to
  live. The consequence, accepted deliberately: a high-tier item queued
  offline blocks that review session at that item until reconnection —
  there is no "skip it and come back," matching the same anti-cherry-
  picking principle the workspace already enforces everywhere else.
- **A late-arrival decision is accepted whenever the reviewer once truly
  held the claim — full stop, not only when it was provably reassigned.**
  `review_claims` is keyed on `item_id` alone and gets overwritten on
  reassignment, so "expired but nobody reclaimed it yet" and "expired and
  reassigned" are indistinguishable from that table alone. Treating any
  post-expiry decision as late-arrival is the simpler, safer rule — an
  offline decision's exclusive window on an item closed the moment its
  claim expired, regardless of who (if anyone) holds it now.
- **`decision_context` is a real, queryable column — not inferred from
  "no state transition occurred."** The user's explicit requirement,
  anticipating session F / canonical 09's inter-rater agreement work,
  which needs to select on this positively rather than reconstruct it
  from absence.
- **The idempotency contract needs both halves to hold.** Server:
  `ON CONFLICT (idempotency_key) DO NOTHING` plus a fallback lookup.
  Client: the same generated key reused across every retry of one queued
  write, never minted fresh per attempt. Documented together in
  `CLAUDE.md` since one without the other is not actually idempotent.
- **A stale ref in a DOM event listener effect is a real bug class, not
  a theoretical one.** Found via a flaky keyboard test that only failed
  under repeated/loaded runs: `useReviewFlowKeyboard`'s `[flow]`-keyed
  effect tore down and rebuilt the `keydown` listener on every render;
  this session's added async state (offline counts refreshing in the
  background) increased render frequency enough to reliably expose the
  race. Fixed with the latest-ref pattern, using `useLayoutEffect` for
  the ref sync specifically — see `CLAUDE.md`'s new entry for why
  `useEffect` there was insufficient.

**Open at close:**

- Session F / canonical 09 (gold items, audit, payment accrual,
  inter-rater agreement) is what will actually query
  `decision_context = 'late_arrival'` for the first time — nothing reads
  it yet beyond the count surfaced in `ReviewHeader`.
- No UI affordance to inspect *which* items are queued or cached (by
  design — 7.9 forbids a queue browser, and that principle was extended
  here rather than carved out an exception for the offline case), only
  aggregate counts.
- The service worker's app-shell cache is exercised only by its own
  component test (`ServiceWorkerRegistration.test.tsx`, which mocks
  `navigator.serviceWorker.register`); `sw.js` itself was not run in a
  real browser this session, unlike session 07's live Playwright pass —
  this session's DONE WHEN was phrased as tests to cover, not a live
  driving pass, so that's what was built to.
- Neither this PR nor (per session 07's own "open at close") any earlier
  one has been checked against `main` in this session — the user's usual
  PR-and-merge workflow from session 07 wasn't invoked this time.

**Next:** session F (canonical 09) — gold items, audit, and payment
accrual — or whatever PR/merge housekeeping the user prioritises first.

## Session 09 — gold items, audit, and payment accrual (2026-08-09, `session/09-audit-payment`, PR against `main`)

Closes the quality loop and the money loop (plan 7.11): gold-item scoring,
moderator audit, accuracy thresholds, inter-rater agreement, payment
accrual, the weekly payment run, and the content-lead dashboard.

**Built:**

- `packages/shared`: four new pure logic modules, each tests-first —
  `gold-scoring-policy.ts` (`scoresAgreement`, `edit_and_approve` counts as
  approve, and checks the edited key against the reference when both are
  present), `earnings-policy.ts` (`computeEarningsKobo` deliberately takes
  no `action` parameter — rejections pay the same as approvals *by
  construction*, not by convention, so there is nothing to "optimise"
  later), `accuracy-threshold-policy.ts` (`evaluateAccuracyThreshold`:
  `ok` / `recalibrate` / `deactivate`, tracking consecutive failures),
  `inter-rater-agreement.ts` (`computeInterRaterAgreement`, explicitly
  documented as a content signal, not a reviewer signal). `content-lead-policy.ts`
  adds the dashboard's shapes, the `ContentLeadService` contract, and
  `aggregateRejectionReasons` — sums the repository's per-subject-week rows
  into one per-subject-reason total across the whole window, which is what
  actually answers "which prompt defect to fix next" rather than a single
  week's top row.
- `packages/db` migrations `0017`–`0019`: `items.inference_cost_usd`;
  `payment_rate_configs` / `payment_batches` / `payment_batch_lines` /
  `reviewer_earnings` (versioned-config-table pattern, append-only guard
  triggers); `gold_item_scores` (append-only) and
  `accuracy_threshold_configs`. `reviewer_earnings` gets a *partial*
  immutability guard: `amount_kobo`/`rate_basis` never change; `paid_at`/
  `payment_batch_id` may move from NULL to a value exactly once.
- Repositories, each with its own integration tests against a real
  Postgres: `reviewer-quality-repository.ts` (`scoreGoldDecision`, rolling
  `accuracy_score`), `reviewer-earnings-repository.ts` (`recordEarning`,
  reads the active `payment_rate_configs` row), `moderator-audit-repository.ts`
  (random weekly sample of one reviewer's approvals, excluding anything
  already audited), `accuracy-threshold-sweep.ts` (recalibrate re-issues
  nothing yet — it only flips `reviewers.status` to `'calibrating'`, since
  generating an actual 30-item set is unbuilt; deactivate reuses the
  *existing* `quarantined`→`reworked` transitions to requeue the reviewer's
  recent approvals, rather than inventing a new lifecycle event — both
  handlers were already actor-free), `inter-rater-agreement-repository.ts`
  (pairs the two chronologically-earliest *live* decisions per item — the
  state machine's own guards mean a live-decided item never accumulates a
  third), `payment-run-repository.ts` (`generatePaymentRun`: locks every
  unpaid `reviewer_earnings` row, idempotent within one transaction because
  a second call sees its own prior UPDATE and finds nothing left unpaid),
  `content-dashboard-repository.ts` (five metrics), `content-lead-service.ts`
  (the pool-managed composition of all of the above, exposed from `@jamb/db`'s
  index — only the composed functions, never the per-client pieces).
- `decideOnItem` wires gold scoring and earnings into its existing
  transaction, for both `'live'` and `'late_arrival'` decisions alike.
  Neither call's result is ever reflected in the outcome returned to the
  caller.
- `apps/api`: `requireContentLead` middleware (mirrors `requireModerator`).
  `/content-lead/dashboard` and `/content-lead/payment-runs` are
  content-lead-gated; `/content-lead/audit-sample` and
  `/content-lead/audits/:itemId` are moderator-gated, with `moderatorId`
  always taken from the session, never the request body.
- `apps/admin`: `/content-lead`, a `content_lead`-only route (redirects
  anyone else to `/`; login sends a `content_lead` session there instead
  of the reviewer workspace). `ContentLeadDashboard` renders all six
  metrics, with a "Fix next" callout driven by `aggregateRejectionReasons`.
  `useContentLeadDashboard` takes an explicit `enabled` flag — without it,
  the fetch effect fires once on mount for *any* authenticated session
  before the page's own redirect-away effect has a chance to run, since
  hooks run unconditionally ahead of a component's early return.

**DONE WHEN verification:** ran the real stack against a live, seeded
Postgres database — `pnpm typecheck` and `pnpm test` clean across all five
packages (831 tests, zero failures, zero skips with `DATABASE_URL` set);
seeded a `content_lead` reviewer and a deliberately lopsided rejection
history (`implausible_distractor` dominant at 9 across two weeks, beating
any single week's row), started `apps/api` and `apps/admin`'s dev servers,
logged in through the real `/api/review/login` route and fetched
`/api/content-lead/dashboard` through the same Next.js proxy the browser
uses — the response matched the seed exactly, `implausible_distractor`
first. Playwright is not installed in this environment and wasn't added
without asking first, so this was a live HTTP round-trip through the real
proxy and route stack rather than a captured screenshot; `ContentLeadDashboard.test.tsx`
separately proves that exact response shape renders correctly in the DOM.

**Decisions worth remembering:**

- **Earnings are never clawed back on deactivation.** When
  `sweepReviewerAccuracy` deactivates a reviewer and requeues their recent
  approvals for re-review, the `reviewer_earnings` rows for those decisions
  are left untouched. The user's own framing: the work was genuinely done
  at the time, and removal from the panel is the remedy, not retroactive
  unpaid work. Stated here and in `sweepReviewerAccuracy`'s own doc comment
  so it isn't rediscovered as a question later.
- **Convention: a comparison that must stay blind to the user needs
  symmetric work, not just symmetric output.** Gold-item scoring must not
  leak through timing any more than through status codes or response
  shape. `scoreGoldDecision` originally ran one query for a non-gold
  decision but four for a gold one (lookup, insert, average, update) — a
  reviewer measuring response latency across many decisions could in
  principle use that asymmetry to infer which of their own past items were
  gold. Fixed by running the accuracy recompute-and-write unconditionally:
  for a non-gold decision it just rewrites the same value, since no new
  `gold_item_scores` row exists to change it. Only the one `INSERT` still
  differs. A dedicated integration test asserts `decideOnItem`'s outcome is
  identically shaped and valued for a gold item and an ordinary one — same
  reasoning as collapsing the two 403 cases in session 06, extended from
  "the response must look the same" to "the server must have done the same
  amount of work to produce it." Matching output while branching
  internally on the hidden fact is not enough — the branch itself is a
  side channel. **This will come up again in session 10:** sampled review
  (an item pulled for spot-check re-review, invisible to the reviewer who
  drew it) is the same shape of problem as a gold item — a decision whose
  hidden status must not be inferable from how the request behaves. Route
  it through the same discipline: identify every place the sampled/
  not-sampled branch changes query count, call count, or control flow, and
  make the unsampled path do the equivalent work rather than skip it.
- **A reviewer's second-review status cannot be read from `item.status` at
  decide time.** Claiming an item already transitions it from
  `needs_second_review` to `in_review` *before* `decideOnItem`'s own
  `SELECT status ... FOR UPDATE` runs, so `item.status === 'needs_second_review'`
  can never be true when a live decision is being recorded — regardless of
  whether it's the first or second reviewer. Found via an end-to-end wiring
  test (the second reviewer's earnings came back short the high-tier
  second-review bonus), fixed by computing `isSecondReview` from
  `priorDecisions.length > 0` instead, which was already being loaded for
  the state-machine call at that point.
- **`inference_cost_usd` and `reviewer_earnings.amount_kobo` are never
  summed.** Different currencies; blending them without a real exchange
  rate would fabricate precision that doesn't exist. The dashboard reports
  `avgInferenceCostUsd` and `avgReviewerFeesKobo` as two separate numbers —
  the plan's own "split into" framing, taken literally.
- **`TRUNCATE subjects, users CASCADE` cannot reach `payment_batches`.**
  It's referenced *from* `reviewer_earnings`/`payment_batch_lines`, never
  the reverse, so nothing in the subjects/users cascade graph points at it.
  A test that runs a real payment left a stray batch row polluting a later
  file's row-count assertions; fixed by adding `payment_batches` to
  `review-queue.fixtures.ts`'s `TRUNCATED_TABLES` explicitly, which also
  protects every future test that touches payment data the same way.

**Open at close:**

- Recalibration (`sweepReviewerAccuracy`'s `'recalibrate'` verdict) only
  flips `reviewers.status` to `'calibrating'` — it does not re-issue an
  actual 30-item calibration set, because nothing in this repo generates
  or serves one yet. Whatever session eventually builds calibration sets
  should read this status as its trigger.
- No bank-transfer batch *file* is generated — `generatePaymentRun`
  produces `payment_batches`/`payment_batch_lines` rows and a per-reviewer
  statement is queryable from them, but nothing writes them out to a file
  format a real payment processor would accept. The session prompt's
  "generate a bank transfer batch file" is satisfied at the data level,
  not the file-export level.
- The content-lead dashboard has no UI for triggering a payment run or
  recording a moderator audit — `/content-lead/payment-runs` and
  `/content-lead/audits/:itemId` exist and are tested at the route level,
  but nothing in `apps/admin` calls them yet. The DONE WHEN requirement was
  specifically the dashboard rendering live data with the rejection-reason
  aggregation obvious at a glance; those two routes were built because the
  session prompt named them explicitly, not because the dashboard page
  needed them.
- Subject names never reach the dashboard — every subject-scoped row
  renders as `Subject #<id>`. `ContentDashboard` only carries `subjectId`;
  resolving it to a name would mean either a join the repository queries
  don't currently do or a second fetch the admin app doesn't yet make.

**Next:** whatever PR/merge housekeeping the user prioritises first, or
the item generation pipeline (canonical session 10).

## Session 10 — the item generation pipeline (2026-08-09, `session/10-generation-pipeline`, PR against `main`)

Builds `tools/item-gen`, the batch program that authors items with the
Anthropic API, gates them automatically, and writes them into the same
lifecycle every other item goes through (item-generation-spec.md, plan
7.3/7.4/7.14). Wires the two things earlier sessions built with no
caller: `shouldSampleForReview` (session 05) and `items.inference_cost_usd`
(session 09).

**Built:**

- Workspace: `pnpm-workspace.yaml`'s `tools` entry becomes `tools/*`
  (previously matched nothing — no `package.json` sat directly under
  `tools/`). New `item-gen` package; a root `item-gen` script filters into
  it so `pnpm item-gen --subject chemistry --objective-id 42 --count 10`
  works verbatim from the repo root.
- Migration `0020_item_embeddings`: `items.stem_embedding DOUBLE
  PRECISION[]`, nullable. No pgvector — duplicate detection is a linear
  scan of one subject's rows in application code, fine at plan 7.2's
  target volumes (thousands per subject, not millions).
- `packages/shared`: `item-gen-gates.ts` (tests first) —
  `computeKeyDistribution`, `permuteToRebalance` (greedy least-used-label
  assignment, `{{OPTION:A}}` placeholder rewriting instead of regex-guessing
  literal letters in the model's prose — see its own doc comment),
  `validateItemSchema` (four options, one key, distractor_rationale on
  every wrong option, no duplicate/all-or-none/length-outlier options),
  `cosineSimilarity`, `detectsCalculationHeuristic` +
  `resolveContainsCalculation` (three independent signals: explicit
  operators, calculation-indicating phrasing, all-numeric options — ORs
  with the model's own self-report, never lowers it). `item-gen-cost.ts`
  (tests first) — `computeCallCostUsd` against a maintained pricing table,
  `apportionAuthoringCost`, `computeItemInferenceCostUsd`.
- `packages/db`: `item-generation-repository.ts` —
  `loadObjectiveContext` (subject/topic/subtopic/objective, joined up the
  hierarchy), `insertGeneratedItem`, `loadLiveBankEmbeddings` (everything
  in the subject not `rejected`/`retired`), `promoteGeneratedItem` — the
  exact `applyRequeueTransition` pattern from session 09's
  accuracy-threshold-sweep: `transition()` from `@jamb/shared`, then one
  `items` UPDATE and one `item_state_transitions` INSERT, for both
  `auto_gate_promote` and `gates_passed` alike. New `@jamb/db/fixtures`
  export subpath (mirroring the existing `./session-tokens` /
  `./reviewer-errors` pattern) so `tools/item-gen`'s integration tests can
  seed real syllabus/subject data with `review-queue.fixtures.ts` without
  duplicating it.
- `tools/item-gen/src/`: `anthropic-client.ts` / `voyage-client.ts` — plain
  `fetch`, no SDK, injectable `fetchImpl`; `retry.ts` — exponential
  backoff, injected `sleep`; `authoring-prompt.ts` (spec §4's template plus
  `contains_calculation` in the requested JSON, since `deriveRiskTier`
  needs it and the spec's own listed keys don't include it) /
  `independent-solve-prompt.ts` (stem + options only — `IndependentSolveInput`
  has no `isCorrect`/`distractorRationale` field at all, so leaking the key
  into the blind-solve prompt is a compile-time impossibility, not a
  runtime discipline); `parse-authoring-response.ts` (turns the model's
  JSON into `ItemDraft`s, dropping anything too malformed to even attempt);
  `raw-response-logger.ts` (every raw response to `generated-items-raw/`,
  a directory `.gitignore` already anticipated); `gate-report.ts`; the
  orchestration core `run-generation.ts` and the thin CLI entry `cli.ts`.
- Per-item pipeline order (cheapest checks first, so a doomed item never
  pays for a call it didn't need): schema validation (free, local) →
  duplicate check (one Voyage embed call) → independent solve (one
  Anthropic call) → sampling draw (low-risk items only) → insert +
  promote, all in one transaction. A schema failure or duplicate hit skips
  the solve call entirely.
- Concurrency-limited (hand-rolled limiter, no `p-limit` dependency) per
  batch; duplicate detection compares against the live bank and every item
  already inserted earlier in the same batch.

**DONE WHEN verification:** `pnpm typecheck` and `pnpm test` clean across
all six packages — 924 tests, zero failures. `runGeneration`'s own
integration test suite exercises the full pipeline against fake HTTP and a
real Postgres database: a batch producing one auto-gated item, one
pending-review item (independent solve disagreed), and one gate-failed
item (missing distractor_rationale) in a single run; a near-duplicate of
an existing live item flagged without ever calling the solve API for it;
a low-risk item forced into the sampling draw landing in pending_review
instead of auto-gated; a structurally malformed authored item discarded
before it ever becomes a row; authoring cost apportioned exactly across
the items that survived to insertion. No `ANTHROPIC_API_KEY` or
`VOYAGE_API_KEY` exists in this environment, so the literal
"running against one Chemistry objective produces 10 items in the
database" was not executed against the real API this session — the user
chose "build fully tested, defer the live run" when asked, and that is
what this delivers: every code path proven against fakes, the real batch
run is the user's to make once real keys are set.

**Decisions worth remembering:**

- **A comparison that must stay blind needs symmetric work — but only
  where something is actually hidden.** The session 09 timing-side-channel
  convention was checked against this session's own sampling draw: a
  high-risk item is excluded from the automated route by `risk_tier`
  alone, and `risk_tier` is already visible in the item's own content (a
  calculation item looks like one) — nobody is trying to keep that hidden.
  So the sampling draw only runs for low-risk items; skipping it for a
  high-risk item reveals nothing that wasn't already obvious. The
  convention is about protecting a genuinely hidden fact's inferability,
  not about making every branch do identical work regardless of whether
  anything is actually secret.
- **`contains_calculation` is `modelSelfReport OR heuristicMatch`, never
  the reverse.** The heuristic (explicit operators, calculation-indicating
  phrasing, all-numeric options) can only raise the flag to true, never
  lower a model's own `true`. A false positive costs one extra human
  review; a false negative risks an unreviewed wrong key reaching a
  candidate — the asymmetry in that trade-off is why the combination isn't
  symmetric either.
- **Authoring cost is apportioned across the items actually inserted, not
  the items requested — including a `gate_failed` item, excluding only a
  draft too malformed to become a row at all.** A batch that authored 10
  items but only 7 survived to insertion still divides the full authoring
  cost by 7, not 10: the 3 failed items' share is redistributed onto the
  survivors, never written off. This is a deliberate accounting choice,
  documented in `item-gen-cost.ts`'s own comment, because it's what makes
  the content-lead dashboard's "cost per approved item" an honest number —
  silently excluding failed items' cost would make a batch with heavy
  waste look exactly as cheap as a clean one.
- **A pre-existing cross-package test race, exposed by this session's new
  integration tests, not caused by them.** `apps/api`'s
  `login-end-to-end.integration.test.ts` inserts a `users` row and then a
  `reviewers` row in two separate, unguarded queries. `pnpm -r run test`
  runs every package's test script concurrently by default, and CI's own
  `pnpm test` step does exactly that against one shared Postgres service —
  so a `tools/item-gen` integration test truncating `users` mid-way
  through that two-step insert produces a real, intermittent FK-violation
  failure, confirmed by running `apps/api`'s suite alone (passes every
  time) versus the full `pnpm test` (flaked). Fixed at the root: the root
  `test` script now runs with `--workspace-concurrency=1`, so no two
  packages' DB-touching integration tests ever run at the same time. Each
  package's own `fileParallelism: false` already prevented the same race
  *within* one package; this closes the gap *between* packages.
  **This trades CI wall-clock time for correctness, deliberately — it is
  not a permanent ceiling.** If that trade stops being worth it as more
  packages accrue their own integration suites, the real fix is giving
  each package's integration tests their own database or schema, so
  concurrent truncation across packages stops being possible in the first
  place, rather than raising this back toward concurrent execution and
  reintroducing the race. `--workspace-concurrency=1` is the cheap fix for
  today's package count, not the permanent shape of this trade-off.
- **Rebalancing the key distribution controls the prompt, not the parser.**
  `permuteToRebalance` needs `explanation`/`method_steps` to reference an
  option after its label has changed. Regex-guessing which literal letter
  in the model's free-form prose means "option A" (versus the article "a",
  or an unrelated capital letter) is exactly the kind of fragile heuristic
  this repo has avoided elsewhere — so the authoring prompt asks the model
  to write `{{OPTION:A}}` instead of the letter, and rebalancing is then a
  deterministic string substitution, not a guess.

**Open at close:**

- The real batch run against a live Chemistry objective — DONE WHEN's
  literal database-row outcome — has not been executed. `runGeneration`
  is proven against fake HTTP and a real database; the actual API cost
  and the real model's actual output quality (does the authoring prompt
  in practice produce items that pass the gates at a reasonable rate?)
  are unverified until a real run happens.
- No embedding model version pinning beyond the `VOYAGE_MODEL` env var's
  current value — if Voyage deprecates a model version, `stem_embedding`
  values generated under different model versions would be compared
  against each other by `loadLiveBankEmbeddings`/`cosineSimilarity` with
  no warning that they're not directly comparable. Not a problem at this
  session's scale (one model, one run), worth a column recording which
  embedding model produced a given vector before this pipeline runs at
  real volume.
- `MODEL_PRICING` in `item-gen-cost.ts` is a maintained constant with no
  live pricing API behind it — its own comment says to verify it against
  Anthropic's current published pricing before trusting a real cost
  figure. It was not verified against a live source this session.
- The multi-objective / whole-subject batch run the sequencing table in
  the spec (§6) implies ("Wave 1: Use of English, Biology... 2,000 items")
  is out of scope — the CLI processes exactly one `--objective-id` per
  invocation, matching the literal usage example. Running a whole wave
  means invoking it once per objective, currently with no orchestration
  wrapper around that loop.

**Next:** a real batch run against a live Chemistry objective once
`ANTHROPIC_API_KEY`/`VOYAGE_API_KEY` are available, or whatever the user
prioritises next.

## `tools/item-gen` provider switch: Anthropic → OpenAI (2026-08-16)

Not a numbered session — infra work forced by a real-world constraint, done
while getting the app running locally for the first time (Windows, local
PostgreSQL 18) ahead of the session 10 "real batch run" that was still open.
**Reason: Anthropic's billing did not accept the user's available payment
method; OpenAI credits were already paid for.** Scope was deliberately kept
to the text-generation calls only — Voyage (embeddings, duplicate detection)
is a separate vendor with its own payment method and was left untouched, a
choice made explicitly rather than assumed.

**Built:**

- `tools/item-gen/src/openai-client.ts` replaces `anthropic-client.ts`:
  `POST https://api.openai.com/v1/chat/completions`, `Authorization: Bearer`
  (not `x-api-key`), request `{model, messages, max_tokens}`. OpenAI's Chat
  Completions API has no top-level `system` field the way Anthropic's
  Messages API does — a `system` input is prepended as a `{role: 'system'}`
  message instead, kept as a caller-facing option on `callOpenAi` even though
  no current call site in `run-generation.ts` uses it, for shape-parity with
  the module it replaces. Response shape: `choices[0].message.content` /
  `usage.prompt_tokens`/`completion_tokens`, vs. Anthropic's `content[].text`
  / `input_tokens`/`output_tokens`. Same injected-`fetchImpl` discipline,
  same `isRetryable*Error` classification (429/5xx retryable) as the module
  it replaces.
- `tools/item-gen/src/fetch-types.ts`: `FetchImpl` extracted out of the
  provider client file it used to live in (`anthropic-client.ts`) into its
  own tiny module, since `voyage-client.ts` already depended on that type
  and importing a generic type from a specific provider's client file would
  have been the wrong direction of coupling once that file was `openai-client.ts`
  instead.
- `run-generation.ts`: both call sites (authoring, independent-solve) swapped
  to `callOpenAi`/`isRetryableOpenAiError`; `RunGenerationDependencies` fields
  renamed `openaiApiKey`/`openaiModel` (matching the existing
  provider-specific naming precedent — not a new generic abstraction, since
  there's no present need to swap providers again easily).
- `cli.ts`: `OPENAI_API_KEY`/`OPENAI_MODEL` env vars, default model
  `gpt-4.1`.
- `packages/shared/src/item-gen-cost.ts`: `MODEL_PRICING`'s Claude entries
  removed (dead once nothing passes those model strings anymore) and
  replaced with `gpt-4.1: { inputCostPerMillionUsd: 2, outputCostPerMillionUsd: 8 }`,
  verified directly against `developers.openai.com/api/docs/pricing` at
  the time this entry was added — standard tier, not cached-input or batch
  pricing. This repo's own Claude pricing entries (session 10) were never
  verified against a live source per that session's own build-log entry;
  this one was, closing that gap for at least this row.
- `.env.example`: `ANTHROPIC_API_KEY` → `OPENAI_API_KEY`, comment updated;
  `VOYAGE_API_KEY`'s comment reworded since "Anthropic has no embeddings
  endpoint" was the old justification for Voyage's independence and no
  longer the accurate reason (OpenAI also has no embeddings call used by
  this pipeline; Voyage's independence stands regardless of which vendor
  authors items).
- Every test touching the old shape updated: `openai-client.test.ts`
  (replacing `anthropic-client.test.ts`, same coverage — request shape,
  system-message prepending, text/usage extraction, error status handling,
  retryable-error classification), `run-generation.integration.test.ts`'s
  fake HTTP fixtures (URL host check, response body shape, token-usage
  field names, the cost-apportionment test's hard-coded dollar amounts
  recomputed for `gpt-4.1`'s $2/M rate instead of Claude's $3/M),
  `voyage-client.test.ts`'s import path, and a stray `'claude-sonnet-5'`
  literal in `item-generation-repository.integration.test.ts`'s fixture.

**Verification:** `pnpm typecheck` (6/6 packages), `pnpm test` (925 tests,
zero failures, against a real local Postgres — not Docker, the first time
this repo's test suite has been run that way), `pnpm lint` — all clean.

**Decisions worth remembering:**

- **Domain logic (prompts, response parsing, gating) needed zero changes.**
  `authoring-prompt.ts`/`independent-solve-prompt.ts` were already plain
  text with no Claude-specific framing, and `parse-authoring-response.ts`
  already defensively strips markdown code fences before parsing JSON — a
  provider-agnostic pattern that happened to already cover GPT's own
  tendency to wrap JSON in fences. The entire change was confined to the
  HTTP client, the dependency-injection wiring, and the cost table — proof
  that injecting `fetchImpl`/`anthropicApiKey`/`anthropicModel` rather than
  reaching for an SDK (session 10's original design choice) paid for itself
  the first time a provider swap was actually needed.
- **Voyage was evaluated and deliberately kept, not assumed.** Only
  Anthropic had a payment-method problem; Voyage is a separate vendor with
  its own billing relationship. Consolidating embeddings onto OpenAI too
  was asked about explicitly and declined — scope stayed to exactly the
  constraint that motivated the change.

**Open at close:** the real batch run itself (English objective 1, Biology
objective 33, 10 items each — the pair agreed on before this switch, per
plan §7.4's low-risk starting point) had not yet been executed against the
new OpenAI client as of this entry; that's the very next step once
`OPENAI_API_KEY` is in the shell that runs `tools/item-gen`.

**Next:** the deferred real batch run, now against OpenAI.

## Incident: local dev database wiped by running `pnpm test` against it (2026-08-16)

Between this entry and the previous one, the real batch run got delayed by
a real mistake, worth recording so it isn't repeated. Immediately after the
provider switch above, `pnpm test` was run to verify it, with `DATABASE_URL`
pointed at `postgres://jamb:jamb@localhost:5432/jamb_prep` — the user's one
local Postgres database, already carrying manually-seeded content, a
hand-created reviewer account, and two items flipped to `pending_review`
for testing the reviewer workspace. This repo's integration tests clean up
with `TRUNCATE ... CASCADE` on shared tables (`subjects, users CASCADE`,
documented in `CLAUDE.md`) — a deliberate, correct pattern, but one that
assumes the database it runs against is disposable. In CI it is: the
`postgres` service (`.github/workflows/ci.yml`) is thrown away after every
run. **Locally there is no separate test database — `docker-compose.yml`
and every documented `DATABASE_URL` example point at the single `jamb_prep`
database, for both running the app and running the tests.** `pnpm test`
truncated every table; schema/migrations survived untouched, but `users`,
`reviewers`, `items` — everything — went to zero rows.

**Recovery (nothing here was irreplaceable — all synthetic setup, not real
user data):** re-ran `pnpm --filter @jamb/db run seed`; recreated the
reviewer (`reviewer@example.com` / `devpassword123`, role `reviewer`,
status `active`, assigned to Biology via `reviewer_subjects`) by hand again,
identically to the first time; re-flipped two Biology items to
`pending_review`. **IDs are not stable across this incident** — Postgres's
plain `TRUNCATE` does not reset identity sequences, so every recreated row
got a new, higher ID than before (`users`/`reviewers` continued from
whatever the many test runs during this session had already advanced the
sequences to). The English/Biology objective IDs picked before the incident
(1 and 33) no longer existed afterward — 281 and 313 replaced them. Anyone
reading an ID out of an earlier part of this log or out of memory should
re-query rather than trust it, for the remainder of this local database's
lifetime.

**Root cause, plainly:** running the test suite against a database also
used for hand-seeded local development data, with no separate test
database configured anywhere in this repo for local (non-CI) use. This
gap existed silently through sessions 01–10 because nobody had previously
run `pnpm test` locally against a database that also held content worth
keeping — CI's ephemeral database made the gap invisible.

**Fix — a genuinely separate local test database**, so `pnpm test` can
never again truncate real local dev data:

- A second local database, `jamb_prep_test`, created once
  (`createdb -U jamb jamb_prep_test` or equivalent), migrated the same way
  as `jamb_prep`.
- Local test runs use `DATABASE_URL=postgres://jamb:jamb@localhost:5432/jamb_prep_test`
  — never the dev database's connection string — when running `pnpm test`
  outside CI.
- `docker-compose.yml` and `.env.example` are unchanged (`jamb_prep` stays
  the dev database's name, matching CI); the test database is local-only
  setup, not part of the checked-in stack, since CI's own database is
  already disposable and doesn't need this distinction.

**Next:** the deferred real batch run — now actually executed (see below) —
plus setting up `jamb_prep_test` so this incident's root cause is closed,
not just patched around once.

## Real batch run against OpenAI, English + Biology (2026-08-16)

Executed after the incident above was recovered from, against the
recreated objective IDs (English 281, Biology 313), `--count 10` each, real
`OPENAI_API_KEY`, real database.

**Results:**

- **English (objective 281):** 2 auto-gated, 7 to human review (5 of those
  because the independent solve disagreed with the proposed key — a much
  higher disagreement rate than session 10's fake-HTTP tests exercised, and
  a real, useful first data point on gpt-4.1's independent-solve behavior
  on this objective), 1 gate-failed (`option_length_outlier`), 0 discarded.
  Cost: $0.0333 authoring+solve, $0.0395 total recorded on inserted items.
- **Biology (objective 313):** 5 auto-gated, 5 to human review (all via the
  sampling draw, zero disagreements this time), 0 gate-failed, 0 discarded.
  Cost: $0.0338 authoring+solve, $0.0420 total recorded on inserted items.
- **Combined: 20 items requested, 20 inserted, ~$0.08 total spend across
  both objectives** — confirms the per-item cost is a fraction of a cent to
  low single-digit cents, matching the pre-run estimate given before asking
  for the go-ahead.

**Notable finding, worth carrying into any future batch:** *(correction —
the first version of this entry mislabeled which subject exhibited the
skew; superseded below with the corrected, now much better-evidenced
account after 14 more batches)*. Biology objective 313's own batch was the
one with `A:10 B:0 C:0 D:0` before rebalancing, not English's — English
281 was mildly skewed (`A:3 B:2 C:2 D:3`), not extreme. See the entry below
for the accurate, multi-batch picture.

**Open at close:** `jamb_prep_test` (the fix from the incident above) has
not actually been created yet — the real run above was executed by being
careful with `DATABASE_URL` by hand, not by the safeguard existing. Human
review of the 12 `pending_review` items this run produced hasn't happened.

**Next:** create `jamb_prep_test` before running `pnpm test` locally again;
review the 12 pending items through the reviewer workspace; whatever the
user prioritises after that (canonical session 11, or the candidate-facing
track).

## Closing the incident: `jamb_prep_test` created, guard added and proven (2026-08-16)

The `jamb` role had no `CREATEDB` privilege — granted by the user via
`psql -U postgres -c "ALTER ROLE jamb CREATEDB;"` (their local Postgres 18
install has no `psql` on `PATH`; found at
`C:\Program Files\PostgreSQL\18\bin\psql.exe`). `jamb_prep_test` created
(`CREATE DATABASE jamb_prep_test OWNER jamb`, via `pg` directly since
`createdb`/`psql` weren't reachable from the shell running this session
either) and migrated with all 20 migrations, cleanly.

**A code-level guard was added, not just a documented convention** — a
name-only rule ("remember to use jamb_prep_test") is exactly the kind of
thing that already failed once. `assertSafeToTruncate`
(`packages/db/src/review-queue.fixtures.ts`) checks `current_database()`
before any test-cleanup `TRUNCATE` and throws unless the name contains
`test` or `CI` is set — the `CI` exemption matters because CI's own
disposable Postgres service is literally also named `jamb_prep`, so the
name alone can never distinguish safe from unsafe; only "is this a
throwaway container" can, and `CI` is the closest proxy available. Wired
into all three TRUNCATE call sites: the shared fixture's own
`truncateQueueWorld`, and the two files that TRUNCATE directly
(`reviewer-auth-repository.integration.test.ts`,
`apps/api/src/login-end-to-end.integration.test.ts`).

**Proven, not just asserted:** ran `packages/db`'s test suite with
`DATABASE_URL` deliberately pointed back at `jamb_prep` — every test that
reached a TRUNCATE failed loudly with the guard's own error message,
confirming it actually fires rather than being a no-op. Then verified
`jamb_prep`'s data survived that probe untouched (`users:1, reviewers:1,
items:60` — unchanged), since the guard throws before the TRUNCATE runs.
Then ran the full suite for real against `jamb_prep_test`
(`DATABASE_URL=postgres://jamb:jamb@localhost:5432/jamb_prep_test`):
`pnpm typecheck` (6/6 clean), `pnpm test` (925 tests, zero failures),
matching the same numbers as the last clean run before the incident.

CLAUDE.md gained the standing convention: local integration test runs use
`jamb_prep_test`, never the dev database's connection string.

**Next:** review the 12 `pending_review` items from the real batch run
through the reviewer workspace; whatever the user prioritises after that.

## Real batch run, remaining English + Biology objectives (2026-08-16)

Ran the 14 objectives left untouched in both low-risk subjects (every
English/Biology objective besides 281/313, which each already had a real
run) — `--count 10` each, sequentially, in the background:
Biology 314–320 (cell organelles, monohybrid inheritance, decomposers,
liver function, plant hormones, xylem/phloem, natural selection) and
English 282–288 (synonyms, idiomatic interpretation, diphthongs, word
stress, subject-verb agreement, prepositions, collocation).

**Results, verified against the database (not just CLI output):** 140/140
items requested were inserted — `approved_uncalibrated: 79, pending_review:
51, gate_failed: 11` for these 14 objectives, reconciling exactly against
the per-objective gate reports plus one pre-existing item whose status
predates this run. Total items in the database: 200 (60 before this run:
40 seed + 20 from the first English/Biology run, plus these 140). Combined
authoring+solve spend across all 14: **≈$0.47**, consistent with the
established ~$0.03–0.04 per 10-item batch.

**The key-skew finding from the first run is now well-evidenced, and more
precise than first written (see the correction above).** Across these 14
batches:

- **Biology skewed to a single letter, almost every time.** 6 of 7 Biology
  batches (314, 315, 316, 317, 318, 319) authored `A:10 B:0 C:0 D:0` before
  rebalancing — every one of that batch's 10 items had gpt-4.1 place the
  correct answer on option A. Only objective 320 came out closer to even
  (`A:3 B:3 C:3 D:1`).
- **English did the same thing, but not always onto letter A.** 3 of 7
  English batches (282, 283, 284) were `A:10/9 B:0 C:0 D:0/1`-shaped, but
  285 skewed onto **D** (`A:0 B:1 C:3 D:6`) and 286 skewed onto **B**
  (`A:1 B:9 C:0 D:0`). 287 and 288 were more mixed.
- **The real pattern: gpt-4.1 tends to cluster most or all of one
  authoring call's 10 items onto the *same* option letter, not
  specifically onto "A."** Something about generating 10 items in one
  response correlates their key placement — plausibly an artifact of how
  the model orders/writes each item's options internally, consistent
  across items produced in the same call. This is a materially stronger
  and different claim than "gpt-4.1 defaults to A," and only became clear
  with 14 more data points; a single batch (the first run) wasn't enough
  to tell "always A" apart from "always the same single letter."
  `permuteToRebalance` corrected every one of these to a roughly even
  split as designed — no defect ever reached the live bank — but this is
  a real, now well-supported operating characteristic of this model worth
  knowing before authoring larger batches.

**Open at close:** 51 more items landed in `pending_review` from this run
(101 total now pending across all objectives run so far), none reviewed
yet. No batch has been run yet for a calculation-bearing subject
(Mathematics, Physics, Chemistry) — plan §7.4's low-risk-first guidance has
been followed to the letter so far, but every subject besides English and
Biology remains fully unexercised against the OpenAI pipeline.

**Next:** review the growing `pending_review` backlog through the reviewer
workspace; decide whether to extend generation into a calculation subject
next or hold there; whatever the user prioritises.

## Staffing note: one reviewer per subject is not enough wherever second review triggers (2026-08-17)

Surfaced while the user was scoping a contracting plan (one subject-matter
teacher hired per subject) against how review assignment actually works.
`reviewer_subjects` + `isEligibleForReviewer`'s subject check
(`packages/shared/src/review-queue-policy.ts`) do exactly match a
one-reviewer-per-subject model for *ordinary* review. But
`isEligibleForReviewer` also excludes a reviewer from any item they've
already decided — "7.10's second opinion comes from a second *independent*
reviewer," per its own comment — and this exclusion has no override. Any
item that reaches `needs_second_review` (every `high` risk_tier item after
a first approval, and every item where the independent AI solve
disagreed, after a first approval) can only ever be finished by a
*different* reviewer already assigned to that same subject. A moderator's
escalation-resolution path is a separate mechanism (session 04's guard 5)
and does not substitute for this.

**Consequence: Mathematics, Physics, and Chemistry need at least two
reviewers each, not one.** `deriveRiskTier` (`packages/db/src/risk-tier.ts`)
tiers these three subjects `high` as whole categories regardless of
content, so *every* approved item in them will route to
`needs_second_review` and need a second person to clear it. English and
Biology can run on one primary reviewer each, but will still accumulate
disagreement-driven second-review items no one can clear without an
occasional backup — real in practice, not theoretical: one 10-item English
batch already produced 5 disagreement-flagged items in this session's own
runs.

Not yet a problem in the data (no item has had even a first decision made
yet, so nothing has reached `needs_second_review` in this database today)
but will become one the moment review actually starts on Math/Physics/
Chemistry content with only one reviewer assigned.

## Session 11 — the contributor brief board, Phase 1: text items (2026-08-17)

Plan 7.12: gap detection, brief creation, the open board, claiming,
structured authoring, submission into the ordinary review queue, and
contributor payment. **Scope split, agreed before starting:** the
diagram-request/illustration-ticket/illustrator-queue sub-flow is deferred
to a follow-up session — it needs file upload and object storage, both
completely greenfield in this codebase (confirmed by exploration: zero
existing upload code anywhere, no storage credentials in any `.env`), and
a new dependency for that needs its own sign-off separately from this
session's scope.

**Built:**

- `packages/shared`: `gap-detection-policy.ts` (`detectCoverageGaps`, tests
  first), `brief-policy.ts` (`isBriefClaimable`, `apportionBriefFeeKobo` —
  tests first, shown before implementing per this repo's standing rule),
  `brief-lifecycle.ts` (`BRIEF_STATUSES`, mirroring `item-lifecycle.ts`'s
  single-source-of-truth pattern), `brief-board-policy.ts` (`BriefSummary`,
  `CreateBriefInput`, `ContributedItemInput`, `BriefBoardService` — the wire
  contract `apps/api`'s brief routes need). `content-lead-policy.ts` gains
  `getGaps`/`createBrief` on `ContentLeadService`.
- Migration `0021_contributor_briefs`: `objectives.target_item_count`/
  `requires_human_authorship`; `briefs` table (`open`/`claimed`/`completed`,
  claim-consistency CHECK); `items.brief_id`; `reviewer_earnings.review_decision_id`
  relaxed to nullable with a new `brief_item_id` and a `num_nonnulls(...) = 1`
  consistency CHECK — a contributor fee has no `review_decisions` row to
  reference, so it's keyed to the approved item instead. Reversible; proven
  up/down/up on `jamb_prep_test`. `brief-lifecycle-vocabulary.test.ts`
  (sibling to `lifecycle-vocabulary.test.ts`) guards the new CHECK against
  drift from `BRIEF_STATUSES`.
- `packages/db/src/brief-repository.ts`: `loadObjectiveCoverage`/`getCoverageGaps`
  (pool-managed, optional client, matching `loadActiveQueueConfig`'s
  existing shape), `createBrief`/`claimBrief`/`submitContributedItem`
  (each takes a `reviewers.id` and resolves `users.id` via `loadReviewer`
  — see the new CLAUDE.md convention), `recordContributorFeeOnApproval`.
  `claimBrief` reuses `review-queue-repository.ts`'s `FOR UPDATE SKIP LOCKED`
  inside `withTransaction` pattern for the same reason: two contributors
  racing to claim one brief is the identical concurrency problem as two
  reviewers racing for one queue item. `insertGeneratedItem` (renamed
  nothing, but now genuinely shared) gained `contributorId`/`briefId` and
  a nullable `inferenceCostUsd` to serve both callers.
- `review-decision-repository.ts`'s `decideOnItem` gained the one hook this
  feature needed in existing code: when a decision lands a brief-linked
  item in an approved status, `recordContributorFeeOnApproval` runs in the
  same transaction as the reviewer's own earnings.
- `apps/api`: `GET /content-lead/gaps`, `POST /content-lead/briefs`
  (both `requireContentLead`); new `apps/api/src/routes/briefs.ts` —
  `GET /briefs`, `POST /briefs/:id/claim`, `POST /briefs/:id/submit`, all
  gated only on an active session, no role middleware (see the confirmed
  access decision below).
- `apps/admin`: `/briefs` (the open board, any session), `/briefs/[id]/author`
  (`ContributionForm.tsx` — the full item field set: stem, four options,
  distractor rationale per wrong option, explanation, method steps —
  wider than `InlineEditForm.tsx`, which doesn't cover rationale/method
  steps at all), `/content-lead/briefs` (gaps list + `CreateBriefForm.tsx`,
  gated exactly like `/content-lead`, including the same `enabled`-flag
  fix for the hooks-run-before-redirect bug). `difficultySpread`/
  `cognitiveLevels` are free-form JSON text inputs, matching the database's
  own JSONB flexibility rather than a bespoke structured picker not asked
  for. No new devDependencies.
- Verified against the real running stack, not just fakes: seeded a real
  coverage gap (Biology objective, `target_item_count` set), a real
  content-lead/contributor/second-reviewer account, and drove the actual
  HTTP round trip — login, `GET /content-lead/gaps`, `POST
  /content-lead/briefs`, `GET /briefs`, `POST /briefs/:id/claim`, `POST
  /briefs/:id/submit` — against the real `apps/api` dev server and real
  database. Separately confirmed the contributor's own `/review/next`
  serves them a *different* pending item, never their own submission.

**Decisions confirmed with the user before building:**

1. Brief-board access is any active reviewer-pool account, not gated to
   `role = 'contributor'` — matches how `isEligibleForReviewer` already
   ignores role everywhere else.
2. Contributor fee pays per item, at that item's approval, apportioned
   across `item_count` — not held until the whole brief completes.
3. Diagram/illustration sub-flow deferred to a follow-up session.

**A real bug caught by the tests, not assumed away:** the first version of
`brief-payment.integration.test.ts` assumed a contributed item needs only
one reviewer decision to reach `approved_uncalibrated`, and failed with
`needs_second_review` instead. The actual guard in `item-state-machine.ts`
is `item.riskTier !== 'low' || independentSolveVerdict === 'disagreed'` —
not `riskTier === 'high'` as a narrower reading would suggest — so
`not_generated` also always requires a second opinion. Fixed the test (and
a wrong code comment that had made the same assumption) rather than
loosening the assertion. This directly confirms and strengthens the
staffing note above: contributed items need the same two-reviewer coverage
as a high-risk generated item, not one.

**Verification:** `pnpm typecheck` (6/6), `pnpm lint` (clean), `pnpm test`
(993 tests, zero failures, run against `jamb_prep_test`) — plus the real
HTTP round trip above against `jamb_prep`.

**Open at close:**

- The diagram-request/illustration-ticket/illustrator-queue sub-flow (the
  rest of plan 7.12) is not built. Needs its own session: an upload
  mechanism, an object-storage decision (or a deliberate choice to defer
  real storage further), and a new dependency approved for whichever of
  those is chosen.
- No content-lead UI surfaces the `payment_batches`/`payment_batch_lines`
  a contributor's fee eventually lands in beyond what session 09 already
  built (`/content-lead/payment-runs` triggers a run; nothing new here
  reads a contributor's own earnings statement specifically).
- `apps/admin`'s new pages have no dedicated page-level redirect test
  (matching `app/content-lead/page.test.tsx`'s pattern) — component-level
  tests for `CreateBriefForm`/`ContributionForm` exist and pass, but the
  page-level "wrong role redirects away" behavior for `/content-lead/briefs`
  is asserted only by inspection of the identical, already-tested pattern
  it copies from `/content-lead`, not by its own test.

**Next:** the diagram/illustration follow-up session; or review the
growing `pending_review` backlog; or whatever the user prioritises.

## Session 12 — Mock CBT engine, Phase 1: timer, navigation, and persistence logic (2026-08-17)

`docs/claude-code-prompt-playbook.md`'s "Session 4" (this repo's canonical
12; see the session-order table) — the first work on the candidate-facing
track, after eleven sessions on the content machine. The playbook calls
this "the highest-risk component... the component that must never fail"
and asks for a proposed timer-persistence approach before coding; that
proposal, confirmed with the user, is now in CLAUDE.md's own "Mock CBT
engine" section rather than repeated here.

**Scope split, agreed before starting:** the playbook's prompt describes
building this directly in the mobile app (timer UI, palette, keyboard
shortcuts). `apps/mobile` is a genuinely empty Expo scaffold today — no
SQLite library, no navigation library, nothing past a placeholder screen
and a hand-rolled react-native stub its one existing test runs against —
and CLAUDE.md rule 7 already means almost none of this should be mobile-side
logic regardless. **This session builds and fully tests the logic and
persistence layer only.** The mobile-UI phase (new dependencies: a local
SQLite library, a navigation library) is a deliberate follow-up.

**Built:**

- `packages/shared`: `exam-timer.ts` (`computeSessionEndAt`,
  `computeEffectiveNow` — the monotonic clock-rollback ratchet,
  `computeRemainingSeconds`, `hasExpired`) and `mock-session-reducer.ts`
  (free navigation, independent `answered`/`flagged` booleans, idempotent
  `expire`) — both tests-first, shown before implementing.
- `packages/db`: `exam-config-repository.ts` (`loadExamConfigForUser` —
  the first code ever to read `exam_configs`/`exam_config_subject_rules`,
  written in migration 0006 and seeded since session 01 but never queried
  until now; resolves a real candidate's compulsory-plus-three-elective
  subjects by joining the config's rules against their
  `subject_combination_subjects`) and `session-repository.ts`
  (`startSession`/`recordAttempt` — both idempotent on the same
  conflict-then-lookup pattern `decideOnItem` established,
  `loadSessionForResume`, `scoreSession` composing the above with the
  existing, untouched `scoreExam`).
- **The release-gating scenario proven at the logic level**: a real
  Postgres integration test starts a session, records two answers,
  computes `endAt`/`lastObservedAt` "as of minute 70," discards all
  in-memory state, reloads purely from `loadSessionForResume`, and asserts
  both the recomputed remaining time and every prior answer survive
  intact — including a clock-rolled-back-after-relaunch case proving the
  ratchet holds. The mobile app doesn't exist yet to run this scenario for
  real, but the logic it will depend on is already proven against it.

**Two real, pre-existing gaps found and fixed while building this, neither
about this session's own new code:**

1. `packages/shared/src/scoring.ts` (session 03) had never been added to
   `packages/shared/src/index.ts`'s barrel export — nothing outside the
   package had ever needed it directly until `session-repository.ts` did.
   Fixed by adding `export * from './scoring'`.
2. `exam_configs`/`subject_combinations` are the same "referenced from,
   never pointed at" shape as the `payment_batches` gap from session 11 —
   `TRUNCATE subjects, users CASCADE` alone can't reach either, so a
   leftover row from one test file's run would collide with the next
   file's hardcoded unique value (`exam_year`+`version`, `course_name`).
   Fixed the same way: named explicitly in `review-queue.fixtures.ts`'s
   `TRUNCATED_TABLES`, verified by re-running the full existing suite
   before adding any new tests that depend on it.

**A real design decision made and recorded, not left implicit:**
`recordAttempt` has no field anywhere for a caller to supply `isCorrect` —
correctness is looked up from the item's actual key server-side on every
call, matching CLAUDE.md rule 5 exactly and closing off the possibility of
a client claiming a wrong answer was right.

**Verification:** `pnpm typecheck` (6/6), `pnpm lint` (clean), `pnpm test`
(1036 tests, zero failures, run against `jamb_prep_test`). No new
migration — every table this session reads or writes already existed.

**Open at close:**

- The mobile-UI phase itself: real Expo screens (timer display, question
  palette, keyboard shortcuts A–D and navigation keys, auto-submit),
  local SQLite persistence, and the sync layer that uploads queued
  attempts with their idempotency keys. Needs a local-storage library and
  a navigation library chosen deliberately, not defaulted into.
- `scoring.ts`'s rounding rule is still explicitly flagged (in its own
  README section, unchanged by this session) as "pending verification
  against a real UTME result slip" — worth resolving before this ever
  scores something a real candidate sees.
- No route/API layer yet for starting a session or submitting an attempt
  from outside `packages/db` directly — `apps/api` has no session/attempt
  endpoints, deliberately deferred until the mobile client actually needs
  to call them (adding routes with no real caller yet would be exactly the
  kind of unrequested surface this repo avoids building ahead of need).

**Next:** the mobile-UI follow-up session; or the diagram/illustration
follow-up from session 11; or review the growing `pending_review`
backlog; or whatever the user prioritises.
