# CLAUDE.md — JAMB UTME Prep App

Persistent context for Claude Code. Read this before any task in this repo.

## What we are building

An offline-first JAMB UTME preparation app: mobile client (React Native/Expo,
Android first), Node + TypeScript backend, PostgreSQL, plus an internal content
pipeline that generates and reviews exam items.

The full specification lives at `docs/implementation-plan.md`. **That
document is the source of truth.** If anything here conflicts with it, the
plan wins — raise the conflict rather than guessing.

`docs/implementation-plan.md` is the single source of truth for enums, state
names, orderings and thresholds. Other documents reference it by section
number and must not restate the values. If a value must be repeated, quote
it and cite the section.

## Exam blueprint (drives all scoring and timing logic)

- 4 subjects: Use of English (60 items) + 3 subjects (40 items each) = 180 items
- 120 minutes total, consolidated across all four subjects — NOT partitioned
- 4 options (A–D), one correct, no negative marking
- 400 marks total, 100 per subject
- Candidates navigate freely between subjects and items

**This blueprint must live in the `exam_configs` table, versioned by exam year.
Never hard-code these numbers in application logic.** JAMB changes the format
between cycles and we absorb that as a data update, not a release.

## Non-negotiable architectural rules

1. **Offline-first, not offline-tolerant.** The client runs against a local
   SQLite database. The network is a sync channel, never a prerequisite for
   practising, sitting a mock, scoring, or reviewing.
2. **Attempts are append-only and immutable.** Never update or delete an
   attempt row. This eliminates most sync conflicts by construction.
3. **Local write-ahead persistence.** Every answer is committed to local
   storage before any network call. No submitted attempt may ever be lost.
4. **Idempotent sync.** Every upload carries an idempotency key. Retries must
   never double-count an attempt.
5. **Server is the scoring authority.** The client may compute a provisional
   score for instant feedback; the server recomputes and its result wins.
6. **Syllabus hierarchy is the backbone.** Subject → Topic → Subtopic →
   Objective. Every item maps to exactly one Objective. All diagnostics roll up
   this tree. Never store a topic as a free-text string.
7. **No business logic in `apps/mobile`.** Scoring, timing, item selection,
   spaced repetition and sync logic live in `packages/shared`. Mobile tests
   run against a react-native stub, so anything testable must sit in shared,
   not in the mobile package.

## The test that gates release

A candidate starts a 180-question mock offline, force-closes the app at minute
70, relaunches, and resumes with the correct remaining time and every prior
answer intact. Write tests for this scenario early and keep them green.

## Performance budget (entry-level Android, 2GB RAM)

- Cold start < 3s
- Question transition < 200ms
- Installed app < 30MB excluding content packs
- Subject content pack < 25MB
- API p95 < 400ms

## Code conventions

- TypeScript strict mode, no `any`
- Shared types between client and server live in `packages/shared`
- Database access through the repository layer only — no raw SQL in route
  handlers
- Every migration is reversible and checked in
- Tests colocated with source as `*.test.ts`
- Conventional commits
- Pure logic modules in `packages/shared` (scoring, timing, item selection,
  spaced repetition) validate their inputs and throw on inconsistency —
  an attempt referencing something outside the config, or a config that
  doesn't add up internally — rather than silently tolerating it and
  producing a quietly wrong result. See `packages/shared/src/scoring.ts`
  for the pattern and `packages/shared/README.md` for the specific
  decisions (rounding rule, append-only attempt resolution) it documents.
- Enums shared between the database and the application — item states,
  approval routes, risk tiers, review actions, rejection reasons — are
  declared once in `packages/shared/src/item-lifecycle.ts` and nowhere
  else. No package retypes them locally. The migrations hold the same
  values in CHECK constraints, and
  `packages/db/src/lifecycle-vocabulary.test.ts` fails the build if the
  two ever drift apart.
- **When a rule must exist in both TypeScript and SQL, write a drift
  test.** Some rules genuinely cannot live in one place — concurrency
  safety needs SQL, and CHECK constraints cannot import TypeScript. Where
  that happens, the pure version in `packages/shared` is the statement of
  the rule, the SQL mirrors it, and a test drives every combination of
  inputs through both and asserts they agree. See
  `lifecycle-vocabulary.test.ts` and
  `review-queue-ranking.integration.test.ts`. A duplicated rule with no
  drift test is a defect waiting to happen silently.
- **Rates are fractions in `[0, 1]`, never percentages.** The plan writes
  them as percentages ("30-50%"); code stores 0.3-0.5, names them
  `...Rate`, and throws on anything outside the range. Record the mapping
  next to the field so nobody "corrects" the units back.
- **Inject randomness and the clock; never reach for `Math.random()` or
  `new Date()` inside a decision.** A rule that samples or draws takes a
  `random: () => number`; a transition takes its `occurredAt`. Otherwise
  the behaviour cannot be pinned in a test.
- **A silent failure needs a counter.** If something can stop working
  while every request still succeeds — a stock-out, a queue draining, a
  measurement that quietly stops — record it durably at the point it
  happens. Nothing else will ever surface it. See
  `review_queue_gold_stockouts`.
- Integration tests that need committed data (anything testing real
  concurrency) clean up with `TRUNCATE ... CASCADE`, which is also the
  only way to clear the append-only tables, whose `DELETE` triggers
  reject a `DELETE`. Packages whose tests do this set
  `fileParallelism: false` in their vitest config.
- **Never run `pnpm test` locally with `DATABASE_URL` pointed at a database
  that also holds real local dev data.** This happened for real: running
  the suite against a hand-seeded `jamb_prep` wiped every row in it via the
  `TRUNCATE ... CASCADE` cleanup above — schema survived, all data didn't.
  CI is fine because its `postgres` service is a fresh, disposable container
  per run, even though it's named `jamb_prep` too — the database *name*
  alone can't distinguish "disposable" from "real," so `assertSafeToTruncate`
  (`packages/db/src/review-queue.fixtures.ts`) checks `current_database()`
  and throws unless it contains `test`, or `CI` is set. Every TRUNCATE-based
  test cleanup call site (the shared fixture, plus the two files that
  TRUNCATE directly: `reviewer-auth-repository.integration.test.ts`,
  `apps/api/src/login-end-to-end.integration.test.ts`) calls it first. Run
  local integration tests against a separate `jamb_prep_test` database
  (`DATABASE_URL=postgres://jamb:jamb@localhost:5432/jamb_prep_test`),
  never the dev database's connection string.
- **A column existing is not a column being written.** Two separate bugs
  across three sessions were exactly this shape: `pg` silently returning
  `int8` as a string (session 05), and `item_state_transitions.approval_route`
  going unpopulated from 0012 through 0013 (session 06) because every
  caller up to that point happened to produce the benign value (`null`),
  so nothing looked wrong. Neither was caught by a migration test, a type
  check, or a passing suite — only by a later caller that finally exercised
  the case the gap was hiding. When a migration adds a column that
  application code is meant to write, add a test asserting the column is
  actually populated with the expected value on the relevant code path —
  not merely that the migration applies or that the column exists.
- **`@jamb/db`'s index opens a connection pool the instant it's imported**
  (`client.ts` throws if `DATABASE_URL` is unset, and even when it's set,
  every import shares that one pool). `apps/api`'s `app.ts` and its route
  modules must stay importable with no database — that's what lets
  `createApp` be unit-tested with a fake service — so none of them may
  import `@jamb/db` directly; a service is always injected instead. A pure,
  dependency-free module that both sides genuinely need (`session-tokens.ts`,
  `reviewer-errors.ts`) is exposed as its own `exports` subpath in
  `packages/db/package.json` (e.g. `@jamb/db/session-tokens`) rather than
  re-exported from the index, so consuming it never drags the pool in. Only
  the real entrypoint, `apps/api/src/index.ts`, imports the index itself.
- **Session tokens and password hashes use Node's built-in `crypto`, not a
  dependency.** HMAC-SHA256 bearer tokens (`signSessionToken` /
  `parseSessionToken`) and `scrypt` password hashing
  (`hashPassword` / `verifyPassword`) live in `packages/db` — see
  `session-tokens.ts` and `password-hashing.ts` — precisely so a minimal
  session mechanism never needed a `jsonwebtoken` or `bcrypt` dependency
  approved. Extend these rather than reaching for a new package.
- **A browser-facing app talking to `apps/api` proxies through Next.js
  `rewrites()`, never a `cors` dependency on the API.** See
  `apps/admin/next.config.mjs`: the browser only ever calls same-origin
  `/api/review/...`, and Next.js forwards it server-side to
  `API_BASE_URL`. This is why `apps/admin`'s dev server runs on a
  non-default port (3001) — the API keeps its own default (3000), and
  the two must never collide when both run locally at once.
- **`apps/admin` has real component-testing set up: `jsdom` +
  `@testing-library/react` + `@testing-library/user-event`
  (devDependencies), configured in `vitest.config.mts` and
  `vitest.setup.ts`.** RTL's own auto-cleanup does not register under
  vitest without `test.globals: true` (which this repo deliberately
  doesn't set — explicit imports over implicit globals), so
  `vitest.setup.ts` calls `cleanup()` in an `afterEach` itself; a new
  admin test file doesn't need to re-solve this. `@testing-library/jest-dom`
  was deliberately not added — use plain DOM assertions
  (`element.hasAttribute('disabled')`, not `toBeDisabled()`) rather than
  pulling in another dependency for a handful of matchers.
- **No design-tokens source exists in this repo.** `docs/reviewer-workspace-prompts.md`
  references "the frontend-design skill," which does not exist — not as
  a Claude Code skill, not as a file anywhere in this repo. `apps/admin`'s
  tokens (48px touch targets, a 360px-first type scale, the color
  palette) in `app/globals.css`'s `@theme` block are hand-picked for this
  session, not drawn from a canonical source. If a real design system
  shows up later, reconcile against it rather than assuming
  `app/globals.css` is authoritative.
- **The reviewer workspace's offline layer (`apps/admin/src/lib/offline-store.ts`)
  is IndexedDB, tested against `fake-indexeddb/auto`** (installed once,
  globally, in `apps/admin/vitest.setup.ts` — jsdom has no IndexedDB of its
  own). A test that touches it opens its own uniquely-named database
  (`createOfflineStore('some-test-name')`) rather than relying on any
  cross-test reset, since fake-indexeddb persists per name for the life of
  the process. `AuthProvider` opens the app's one real store
  (`jamb-reviewer-offline`) lazily and asynchronously on mount, exposed as
  `offlineStore: OfflineStore | null` — `null` until that resolves —
  and accepts an already-open store as a prop for tests, exactly like
  `apiClient`.
- **A high-tier item's reveal payload is never prefetched for offline use,
  on purpose.** `canReveal`'s own asymmetry (`packages/shared/review-decision-policy.ts`)
  is the guide: a low or `not_generated` risk_tier item can be fully
  cached including the key, since nothing gates its reveal on an answer;
  a high-tier item's blind answer can be queued and submitted offline, but
  its reveal call stays online-only, deferred until reconnection. This is
  what keeps the answer-before-key guarantee (7.10) resting on the server
  never having released the key, rather than on the client remembering not
  to render data it already has — the stronger, correct place for that
  control to live. `review-flow-reducer.ts`'s `solving` state carries a
  `queued: boolean` for exactly this resting state: a blind answer
  recorded offline with nowhere to advance to until reconnection reveals
  it. There is no "skip this stuck item" affordance, deliberately — see
  the "DO NOT BUILD" guard rails in `docs/reviewer-workspace-prompts.md`;
  the same anti-cherry-picking principle extends to a high-tier item
  queued offline.
- **A DOM event listener that reads component state must not be
  re-subscribed on every render.** `useReviewFlowKeyboard` originally
  keyed its `window.addEventListener('keydown', ...)` effect on `[flow]` —
  and `useReviewFlow` returns a fresh object literal every render, so that
  effect tore down and re-attached the listener on every single render,
  including ones triggered by something unrelated (the offline counts
  refreshing in the background). That churn is a real race: a keydown can
  land in the window between the old listener's removal and the new one's
  attachment. Fixed with the standard "latest ref" pattern — a ref updated
  via **`useLayoutEffect`, not `useEffect`** (the listener effect itself
  now has empty deps and attaches exactly once). `useLayoutEffect` matters
  specifically here: it runs synchronously with the DOM commit, whereas a
  passive `useEffect` is scheduled afterwards — late enough that a
  `waitFor`'s `MutationObserver` (or a synchronous `fireEvent` right after
  it) can observe the new DOM while a plain-`useEffect`-updated ref still
  pointed at the previous render's data. See `useReviewFlowKeyboard.ts`.
- **Widening an existing `useCallback`'s dependency array can silently
  break an effect's documented firing invariant.** `useReviewFlow`'s
  bootstrap effect was `[session, requestNextItem]` with a comment
  asserting `requestNextItem`'s identity "only changes when session does."
  Adding `isOnline`/`offlineStore`/`refreshOfflineCounts` to
  `requestNextItem`'s own deps (for the offline layer, session 08) made
  that comment false without touching the effect itself — `offlineStore`
  resolving from `null` to a real value shortly after mount now also
  changed `requestNextItem`'s identity, re-firing the "run once per
  session" effect mid-flight and clobbering in-progress state. The fix
  was keying that effect on `[session]` directly rather than through a
  callback's identity as a proxy for it. When adding a dependency to a
  `useCallback`, grep for every effect that lists it in a dependency array
  and re-check whether that effect's own "when does this fire" comment
  still holds — the callback's growing dependency list is invisible to
  that effect's own deps array.
- **A data-fetching hook used by a role-gated page needs an explicit
  `enabled` flag — the page's own early return does not stop the hook's
  effect from firing first.** React calls every hook in a component
  unconditionally, before any `if (...) return null` in that component's
  body runs — so `ContentLeadPage`'s redirect-away effect for a
  non-`content_lead` session does not prevent `useContentLeadDashboard`'s
  fetch effect from firing once on the very same mount, hitting a route
  that session has no business calling. Fixed by adding an `enabled:
  boolean` parameter the hook's effect checks before fetching, passed as
  `session?.role === 'content_lead'` from the page. Caught by a test that
  rendered the page with a non-`content_lead` session and asserted the
  mocked `apiClient` method was never called — asserting only on the
  redirect, as `app/page.test.tsx`'s existing pattern does, would have
  missed it.
- **The server-side idempotent-retry pattern for a queued/offline write:**
  `decideOnItem` (`packages/db/src/review-decision-repository.ts`) inserts
  with `ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`; when that
  returns zero rows, a helper (`outcomeForIdempotencyKey`) looks up the
  already-recorded row and returns the same outcome the original request
  would have — never a raw unique-violation, never a silent double-apply.
  The client-side half of the contract: `apps/admin`'s offline queue
  (`offline-store.ts`'s `PendingDecision.idempotencyKey`) generates the key
  once, at queue time, and keeps reusing that same stored key across every
  retry until the store confirms success — never a fresh key per attempt.
  Both halves are required; either alone is not idempotent.
- **A write that cannot be applied as the authoritative outcome is still
  recorded, never dropped — with a positive flag, not an inference.**
  When a queued offline decision reaches the server after its claim
  expired and was reassigned, `decideOnItem` records it as an audit-only
  second opinion (`review_decisions.decision_context = 'late_arrival'`,
  migration `0016`) rather than either rejecting it or letting it
  overwrite the item's real outcome. The reviewer who legitimately once
  held the item (proved via `item_state_transitions`, not by trusting the
  claim) always gets this outcome — a forged or never-held claim still
  gets `not_claimed_by_you`. `decision_context` is a real column, not
  derived from "no state transition happened," specifically so a later
  query (7.11's inter-rater agreement) can select on it directly. See
  `packages/shared/review-decision-policy.ts`'s `DecisionContext` doc
  comment for the full reasoning.
- **A money table gets a *partial* immutability guard, not the full
  append-only one.** `reviewer_earnings.amount_kobo`/`rate_basis` are
  immutable forever, exactly like `review_decisions`/`item_state_transitions`
  — but `paid_at`/`payment_batch_id` legitimately need to move, exactly
  once, from `NULL` to a real value when the weekly payment run pays the
  row. The guard trigger (`forbid_reviewer_earnings_rewrite`, migration
  `0018`) allows that one NULL→value transition on those two columns and
  rejects every other change, including a second attempt to set them.
  Money rows that can be silently rewritten are worse than none. (When
  writing a test for a guard like this: Postgres's `now()` is constant for
  the whole transaction, not per-statement — a test that calls
  `SET paid_at = now()` twice in one transaction is setting the *same*
  value twice, which a correct guard allows as a no-op. Use
  `now() + interval '1 minute'` to force a genuinely different value.)
- **A "never leaks" requirement covers status codes, response shape,
  *and* timing.** Gold-item scoring (7.11) must be undetectable by the
  reviewer being scored — same reasoning as collapsing the two 403 cases
  in session 06, extended to timing. `decideOnItem`'s return type
  (`DecideResult`, four fixed fields) makes shape/status leakage a
  compile-time impossibility, not just a runtime discipline. Timing is
  easier to get wrong silently: `scoreGoldDecision` originally ran one
  query for a non-gold decision but four for a gold one, which a reviewer
  measuring response latency across many decisions could in principle use
  to infer which of their own past items were gold. Fixed by running the
  accuracy recompute-and-write unconditionally — for a non-gold decision
  it just rewrites the same value, since no new `gold_item_scores` row
  exists to change it. When a value is computed conditionally on a fact
  that must stay hidden, ask whether the *query count*, not just the
  returned value, still varies with that fact.
- **A deactivated reviewer keeps the earnings for the decisions that got
  them deactivated.** When `sweepReviewerAccuracy` (accuracy-threshold-sweep.ts)
  deactivates a reviewer and requeues their recent approvals for
  re-review, `reviewer_earnings` rows for those decisions are left
  untouched — never clawed back. The work was genuinely done at the time;
  removal from the panel is the remedy, not retroactively unpaid work.
  This is a deliberate product decision, not an oversight — stated here
  and in `sweepReviewerAccuracy`'s own doc comment specifically so it
  isn't rediscovered as an open question by a later session.
- **Reuse an existing actor-free state transition instead of inventing a
  new lifecycle event, when the existing one already fits.** Requeuing a
  deactivated reviewer's approvals for re-review needed no new
  `LifecycleEvent` — `item-state-machine.ts`'s existing
  `approved_uncalibrated` → `quarantined` → `reworked` transitions were
  already actor-free (neither guard dereferences `context.item`), so
  `accuracy-threshold-sweep.ts` drives an item through both rather than
  adding a fifth thing to `ITEM_STATUSES`. Check whether the state machine
  already has a path that means what you need before adding a new event
  or status to it.
- **`item.status` cannot tell you whether a decision is the first or
  second review, at decide time.** Claiming an item already transitions
  it from `needs_second_review` to `in_review` *before* `decideOnItem`'s
  own `SELECT status ... FOR UPDATE` runs, so `item.status ===
  'needs_second_review'` can never be true when a live decision is being
  recorded — regardless of whether it's the first or second reviewer. Use
  `priorDecisions.length > 0` instead (already loaded for the
  state-machine transition call at that point). This was a real bug,
  found by an end-to-end wiring test asserting the actual earnings amount,
  not a narrower unit test — a reminder that "the state machine transition
  succeeded" and "the field I read to decide *how* to score it was
  correct" are different claims, and only an end-to-end assertion catches
  the second one.
- **Two currencies in one dashboard number is a red flag, not a
  convenience.** `items.inference_cost_usd` (USD) and
  `reviewer_earnings.amount_kobo` (NGN kobo) are never summed —
  `costPerApprovedItem` reports `avgInferenceCostUsd` and
  `avgReviewerFeesKobo` as two separate fields. Blending them without a
  real exchange rate would fabricate a precision that doesn't exist.
- **`TRUNCATE subjects, users CASCADE` cannot reach a table that's only
  ever referenced *from*, never *pointed at by*, that graph.**
  `payment_batches` has no FK into subjects/users, only tables
  (`reviewer_earnings`, `payment_batch_lines`) that point *at* it — so
  `review-queue.fixtures.ts`'s existing truncate helper silently missed it
  until a test that ran a real payment left a stray row polluting a later
  file's row-count assertions. `TRUNCATED_TABLES` now names
  `payment_batches` explicitly. When a new table is money- or
  batch-shaped (something other tables reference rather than the reverse),
  check whether the shared truncate fixture actually reaches it before
  assuming it does.

- **A comparison that must stay blind needs symmetric work — but only
  where something is actually hidden.** Session 09's timing-side-channel
  convention (gold-item scoring) generalizes, but it is not "make every
  branch do identical work no matter what." The item-generation pipeline's
  sampling draw (7.3) only runs for a low-risk item — a high-risk item is
  already excluded from the automated route by `risk_tier` alone, and
  `risk_tier` is visible in the item's own content (a calculation item
  looks like one); nobody is trying to keep that hidden. Before applying
  the symmetric-work discipline, ask what fact is actually secret. If
  nothing is, skipping work on the branch that doesn't need it reveals
  nothing.
- **A heuristic that backstops a self-report may only raise the flag,
  never lower it.** `resolveContainsCalculation`
  (`packages/shared/item-gen-gates.ts`) is `modelSelfReport OR
  heuristicMatch` — the model's own `contains_calculation` field is never
  overridden down to `false`. The asymmetry matches the cost of being
  wrong in each direction: a false positive costs one extra human review;
  a false negative risks an unreviewed wrong key reaching a candidate.
  Apply this pattern anywhere a cheap heuristic backstops a more expensive
  or authoritative signal rather than replacing it.
- **When a batch's total cost must be apportioned across its outputs,
  decide explicitly whether failed outputs' share is written off or
  redistributed — and say which, in the code, because it changes what a
  downstream metric means.** `apportionAuthoringCost`
  (`packages/shared/item-gen-cost.ts`) divides one authoring call's cost
  by the items that actually became rows (including a `gate_failed`
  item), not the items requested — a malformed draft's share is
  redistributed onto the items that did survive, never excluded. Silently
  excluding it would make a batch with heavy waste report exactly the
  same average `inference_cost_usd` as a clean one, hiding the signal a
  content lead most needs.
- **`pnpm -r run test` runs every package's script concurrently by
  default, and CI's `pnpm test` does exactly that against one shared
  Postgres service.** Each package's own `fileParallelism: false` (see
  above) only prevents a race *within* that package's own test files — it
  does nothing about two different packages' integration tests truncating
  and inserting into the same shared tables at the same time. Session 10
  hit this for real: `apps/api`'s `login-end-to-end.integration.test.ts`
  inserts a `users` row and then a `reviewers` row in two separate,
  unguarded queries, and a `tools/item-gen` integration test truncating
  `users` mid-way produced an intermittent FK-violation failure — confirmed
  by running `apps/api`'s suite alone (always passes) against the full
  `pnpm test` (flaked). Fixed at the root, not by patching the one test
  that happened to lose the race: the root `test` script now runs with
  `--workspace-concurrency=1`, so no two packages' DB-touching test suites
  ever overlap. Any new package with its own truncate-based integration
  tests inherits this protection automatically; nothing per-package to
  remember.
- **When a batch operation needs to rewrite a reference embedded in
  free-form prose the model wrote, control the prompt so the reference is
  a stable placeholder, not a literal value to regex-guess after the
  fact.** `permuteToRebalance` needs to rewrite which option letter an
  item's `explanation`/`method_steps` refers to after rebalancing changes
  the labels. Guessing which literal capital letter in the model's prose
  means "option A" — versus the article "a," or an unrelated capital
  letter — is exactly the kind of fragile heuristic this repo avoids
  elsewhere. The authoring prompt instead asks the model to write
  `{{OPTION:A}}`, and rebalancing becomes a deterministic string
  substitution. When you control the producer of a value you'll need to
  transform later, make the value easy to transform instead of writing a
  parser to cope with what a free-text producer might have written.

## Content pipeline rules

- Generated items enter with `status: 'generated'`
- Every calculation item requires human review — no exceptions
- Literature, reading-text and diagram items are human-authored, not generated
- Run the independent-solve check (a second model call solving the item blind,
  without sight of the proposed key) before any item reaches a human reviewer
- Rebalance the A/B/C/D key distribution across each batch — generated banks
  skew heavily and this is a real defect, not cosmetic
- Implemented in `tools/item-gen` (session 10) — `run-generation.ts` is the
  orchestration core, tested against fake HTTP and a real database with no
  API key required; `cli.ts` is the thin real-dependency entry point. The
  independent-solve prompt's input type (`IndependentSolveInput`) carries
  no `isCorrect`/`distractorRationale` field at all, so leaking the key
  into that call is a compile-time impossibility, the same discipline
  `RevealResult`/`DecideResult` already established for the reviewer
  workspace.
- **The contributor brief board** (`packages/db/src/brief-repository.ts`,
  canonical session 11, Phase 1 — text items; the diagram/illustration
  sub-flow is a deferred follow-up) reuses `insertGeneratedItem`/
  `promoteGeneratedItem` unchanged for a contributor-authored item —
  `contributor_id`/`brief_id` set, `risk_tier: 'not_generated'`, entry event
  `gates_passed`. The self-review exclusion
  (`assertNotOwnContribution`/`isEligibleForReviewer`) needed zero code
  changes to cover it, since both were already keyed on `contributor_id`
  since session 04. **`risk_tier !== 'low'` — not just `'high'` — triggers
  `transition()`'s `requiresSecondOpinion` guard**, so a `not_generated`
  item always needs two independent reviewers before approval, exactly like
  a high-risk generated item; a contributor's fee is gated on
  `APPROVED_STATUSES`, not on "this is the item's only decision," precisely
  because of this.
- **Every identity parameter into a decision-recording function is a
  `reviewers.id`, never a `users.id`.** `decideOnItem`, `resolveEscalation`,
  and now `createBrief`/`claimBrief`/`submitContributedItem` all take a
  reviewer id and call `loadReviewer` internally to resolve the underlying
  `users.id` — never accept a `users.id` directly from a route, even though
  the DB columns being written (`briefs.created_by`, `items.contributor_id`)
  are themselves `users.id` foreign keys. This also gets the active-reviewer
  check for free, since `loadReviewer` throws `ReviewerNotActiveError`.
- **Splitting one lump sum across several items paid one at a time, with no
  lost or overpaid remainder, needs an explicit "how many have been paid
  already" parameter — not just the total and the count.**
  `apportionBriefFeeKobo(feeKobo, itemCount, alreadyPaidCount)` floors every
  share except the last one paid, which gets the true remainder
  (`feeKobo - perItem * (itemCount - 1)`), guaranteeing the sum across every
  item exactly equals the fee regardless of payment order. `itemCount`
  alone (mirroring `apportionAuthoringCost`'s shape) is not enough once
  payments happen individually rather than all at once.

### Approval routes

Automated gates alone may promote an item to `approved_uncalibrated` without
human review only when all three conditions hold: `risk_tier` is `low`, the
item was not selected by the sampling draw, and `independent_solve_verdict`
is `'agreed'`. Every other item requires a human decision before it can
serve to candidates: every `high` risk_tier item, any item whose
`independent_solve_verdict` is `'disagreed'`, any item selected by sampling,
and any human-authored contribution.

Every item records `approval_route` as one of `'auto_gated'`,
`'human_reviewed'`, or `'moderator_ruled'`, so the share of the live bank no
human has ever seen can be queried directly, at any time, by anyone who asks.

The quarantine rule — error reports above threshold, or discrimination below
the quality floor — applies to `auto_gated` items exactly as it applies to
every other item. Reaching the bank without a human review is not exemption
from being pulled; if anything, an auto_gated item's live performance is the
only check it has ever had, which makes that check non-negotiable.

See `docs/implementation-plan.md` section 7.14 for the full rationale.

## Mock CBT engine (candidate track, canonical session 12)

The candidate-facing exam runtime — timer, navigation, session/attempt
persistence — starts here. **Phase 1 only: the logic and persistence layer
in `packages/shared` and `packages/db`, fully tested. No mobile UI yet** —
`apps/mobile` is still a bare Expo scaffold with no SQLite or navigation
library, and rule 7 already means almost none of this should be mobile-side
logic anyway. Wiring it into real Expo screens is a deliberate follow-up
session, once a local-storage library and a navigation library are chosen
(new dependencies, need sign-off).

- **Remaining time is derived, never stored as a countdown.** A session
  persists one absolute `endAt` timestamp (`packages/shared/src/exam-timer.ts`'s
  `computeSessionEndAt`); nothing about a countdown value is ever written
  to roll back, which is what makes "kill the app to pause the clock"
  impossible by construction.
- **Guarding against a backward device clock is a monotonic ratchet, not
  prevention.** `computeEffectiveNow(actualNow, lastObservedAt)` is
  `max(actualNow, lastObservedAt)` — a clock wound back can never produce
  an effective-now earlier than one already observed, so time can only
  ever appear to move forward. A legitimate forward clock correction just
  costs the candidate a little perceived time, the safe direction to err.
- **`answered` and `flagged` are independent booleans in the session
  reducer** (`mock-session-reducer.ts`), not one exclusive palette status.
  A candidate answering an already-flagged item, or flagging one they've
  already answered, is ordinary exam behaviour the palette must represent.
- **`recordAttempt` never accepts `isCorrect` from the caller.** Rule 5
  ("the server recomputes and its result wins") means correctness is
  looked up from the item's actual key server-side, on every call —
  `RecordAttemptInput` has no field for a client to claim otherwise, the
  same compile-time discipline `IndependentSolveInput`/`RevealResult`
  already established elsewhere for keeping a key out of the wrong call.
- **`exam_configs`/`subject_combinations` are the same "referenced from,
  never pointed at" shape `payment_batches` already taught this repo.**
  Both are now named explicitly in `review-queue.fixtures.ts`'s
  `TRUNCATED_TABLES` — `TRUNCATE subjects, users CASCADE` alone could never
  reach either, which would have left a stray row to collide with a later
  test's hardcoded unique value (`exam_year`+`version`, `course_name`).
- **`packages/shared/src/scoring.ts` (session 03) was never added to
  `packages/shared/src/index.ts`'s barrel export until this session** —
  nothing outside the package had needed it directly before `packages/db`'s
  new session/exam-config repositories did. A reminder that "it compiles
  inside the package" and "it's actually part of the public surface" are
  different claims; check the barrel export when a module that's existed
  for a while turns out to be needed from outside for the first time.

## How I want you to work

- Ask before installing a new dependency
- Propose a plan before writing code for any task touching more than 3 files
- When a decision isn't covered here or in the plan, stop and ask — don't
  invent a convention
- Update this file when we agree a new convention
- Run the test suite before saying a task is done
- Never push to main. Never open a PR without showing me the diff first.
  Pushing a feature branch is fine.
- For a new pure logic module in `packages/shared`, write the tests first
  and show them before implementing.
- Before starting any session's work, confirm the working branch descends
  from the current merged `main` — session 07 was built on a `main` that
  didn't yet have session 06b's auth work, forcing a same-session merge to
  reconcile the two before the PR could land. Check `git merge-base` (or
  equivalent) against `origin/main` first, not after hitting a conflict.
