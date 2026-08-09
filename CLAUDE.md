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

## Content pipeline rules

- Generated items enter with `status: 'generated'`
- Every calculation item requires human review — no exceptions
- Literature, reading-text and diagram items are human-authored, not generated
- Run the independent-solve check (a second model call solving the item blind,
  without sight of the proposed key) before any item reaches a human reviewer
- Rebalance the A/B/C/D key distribution across each batch — generated banks
  skew heavily and this is a real defect, not cosmetic

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
