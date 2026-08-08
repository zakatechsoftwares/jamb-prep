# Claude Code Prompt Playbook — JAMB UTME App

How to drive the build session by session. Copy the prompts; adapt the details.

---

## Setup (do this once, before any prompting)

```bash
mkdir jamb-app && cd jamb-app && git init
mkdir -p docs
# put the plan in the repo, not in the chat
cp ~/Downloads/implementation-plan.md docs/implementation-plan.md
cp ~/Downloads/jamb-seed-items.json docs/seed-items.json
cp ~/Downloads/item-generation-spec.md docs/item-generation-spec.md
# CLAUDE.md goes in the repo root
claude
```

Then, first prompt of the first session:

```
Read docs/implementation-plan.md and summarise back to me, in 10
bullets, what you understand we are building — I want to check you've
got it before we write any code.
```

**Do not skip that check.** If the summary is wrong, fix the understanding now,
not after 2,000 lines of code.

---

## The core principle

Claude Code degrades on vague, oversized asks. "Implement this plan" produces
plausible scaffolding that collapses under the first real requirement.

The plan has 6 phases and 21 workstreams. **One session ≈ one workstream.**
Each session: state the goal, name the files, state the constraints, state what
done looks like.

Structure every prompt as:

```
GOAL:        one sentence
CONTEXT:     which section of the plan governs this
CONSTRAINTS: the rules that must hold
DONE WHEN:   the checkable condition
```

---

## Session sequence

> **This numbering is internal to this document.** This repo interleaves
> this track with `docs/reviewer-workspace-prompts.md`'s own lettered
> sessions, and the two only run in the order shown in
> `docs/build-log.md`'s "Session order" table — not in the order either
> source document lists on its own. In particular, this file's own
> Session 4 and Session 5 below are **not** this repo's sessions 04 and
> 05; see the notes on those two headings.

### Session 1 — Scaffold

```
GOAL: Set up the monorepo skeleton.

Create a pnpm workspace with:
- apps/mobile   (Expo, TypeScript)
- apps/api      (Node, Express, TypeScript)
- apps/admin    (Next.js — content review tooling, later)
- packages/shared (types shared across all three)

Add: strict tsconfig, eslint, prettier, vitest, a GitHub Actions
workflow running lint + typecheck + test.

DONE WHEN: `pnpm test` and `pnpm typecheck` pass from the root, and
each app boots with a placeholder screen/route.

Ask me before adding any dependency not named above.
```

### Session 2 — Data model

```
GOAL: Implement the database schema from section 8.4 of the plan.

Read docs/implementation-plan.md section 8.4 and section 7.6 (item
metadata schema). Write PostgreSQL migrations for every entity listed.

CONSTRAINTS:
- exam_configs is versioned by exam year and holds the blueprint
  (subject count, items per subject, duration, scoring rules) as data
- attempts table is append-only — add a DB-level guard preventing
  UPDATE and DELETE
- syllabus hierarchy is 4 real tables, not a JSON blob
- every table has created_at, updated_at

DONE WHEN: migrations run clean up and down, and a seed script loads
the 2026 exam config plus docs/seed-items.json into a local database.
```

### Session 3 — Scoring engine (pure logic, no I/O)

```
GOAL: Implement the scoring engine as a pure, dependency-free module in
packages/shared.

It takes an exam config + a list of attempts and returns per-subject
scores out of 100 and an aggregate out of 400. No negative marking.
Unanswered items score zero. It must read all counts from the config,
never from constants.

DONE WHEN: unit tests cover — full marks, zero, partial, unanswered
items, a config with different item counts (prove nothing is
hard-coded), and a boundary rounding case.

Write the tests first, show them to me, then implement.
```

### Session 4 — Mock CBT engine

> **Not this repo's session 04.** This repo's session 04 is
> `docs/reviewer-workspace-prompts.md`'s Session A (item state machine) —
> the reviewer-workspace track is a "Phase 1 blocker" that took priority
> over continuing this one after Session 3. This prompt is this repo's
> canonical session **12**; see `docs/build-log.md`'s "Session order"
> table.

This is the highest-risk component. Prompt it deliberately:

```
GOAL: The mock exam runtime — the component that must never fail.

Build the timed mock session engine in the mobile app:
- consolidated 120-minute timer across all four subjects
- free navigation between subjects and items
- question palette showing answered / unanswered / flagged
- keyboard shortcuts: A-D to select, navigation keys to move
- auto-submit on expiry
- every answer written to local SQLite BEFORE any state update

CRITICAL: the session must survive a force-close. On relaunch it
resumes with correct remaining time and all prior answers. Timer state
persists as an absolute end-timestamp, not a countdown integer, and is
guarded against device clock manipulation.

DONE WHEN: there is a test that simulates kill-and-resume at minute 70
of a 180-item mock and asserts both remaining time and answer integrity.

Propose your approach to timer persistence before you write code.
```

### Session 5 — Offline sync

> **Not this repo's session 05.** This repo's session 05 is
> `docs/reviewer-workspace-prompts.md`'s Session B (queue assignment
> service). This prompt is this repo's canonical session **13** — after
> the reviewer workflow (sessions 04–09), the item generation pipeline
> (10) and the contributor brief board (11), and after Session 4 above
> (canonical 12). See `docs/build-log.md`'s "Session order" table.

```
GOAL: Sync layer, per section 8.3 of the plan.

Content sync (server→device): versioned signed bundles, manifest
version on device, delta requests.
Progress sync (device→server): queued uploads with idempotency keys.

CONSTRAINTS: attempts are append-only so uploads are naturally
idempotent — prove it with a test that uploads the same batch three
times and asserts one set of rows.

DONE WHEN: tests cover — offline session then sync, connectivity lost
mid-upload, duplicate upload, and a device rejoining after 30 days
offline.
```

### Later sessions

Same shape, one workstream each: diagnostics rollup → adaptive engine →
payments and entitlements → admin review tooling → institution portal.

> This is canonical session **14+** — after Session 5 above (13). No
> individual prompts are written for these yet; see `docs/build-log.md`'s
> "Session order" table.

---

## Using Claude to generate the question bank

This is a **separate program**, not a Claude Code session. Claude Code writes
the pipeline; the pipeline calls the API in bulk.

```
GOAL: Build the item generation pipeline at tools/item-gen/.

Read docs/item-generation-spec.md. Implement:

1. A generator that reads syllabus objectives from the database and,
   for each, calls the Anthropic API with the authoring prompt from
   section 4 of the spec, requesting 10 items. Concurrency-limited,
   with retry and backoff.

2. The automated gates from section 3, run before any human sees an item:
   - independent solve: a SECOND API call given only the stem and
     options, no key, asked to solve. Disagreement = flag.
   - key balance: report A/B/C/D distribution per batch and permute
     options to rebalance, updating explanation references in step
   - duplicate detection via embedding similarity against the live bank
   - schema validation
   - reject "all/none of the above" and length-outlier options

3. A CLI: `pnpm item-gen --subject chemistry --objective-id 42 --count 10`
   writing to the database with status 'generated'.

4. A cost report: tokens and estimated spend per accepted item.

CONSTRAINTS: never write directly to 'approved_uncalibrated' or
'approved_calibrated'. Calculation items get flagged for mandatory human
review regardless of gate results. Log every raw API response to disk
for audit.

DONE WHEN: running it against one Chemistry objective produces 10 valid
items in the database and a gate report showing what was flagged and why.
```

Then the review tool:

> **Superseded, not queued.** `docs/reviewer-workspace-prompts.md`'s
> Session A through F specify this same feature in far more depth —
> concurrency-safe assignment, the anti-anchoring answer-before-key flow,
> offline support, gold-item accuracy scoring, payment accrual — and are
> already done through this repo's session 06. The short prompt below
> predates that document and is kept only for this file's own narrative
> continuity; do not build it.

```
GOAL: Build the reviewer UI in apps/admin.

A queue-based screen: one item at a time, keyboard-driven (approve /
reject / edit / skip), showing stem, options, proposed key, explanation,
the independent-solve verdict, and the syllabus objective.

Prioritise the queue exactly as docs/implementation-plan.md section 7.9
specifies: (1) items where the blind second solve disagreed with the
proposed key, (2) high risk_tier items, (3) items in needs_second_review,
(4) items flagged by other automated gates, (5) low-risk sampling.
Track reviewer throughput — accepted items per hour — since that's the
metric the content budget depends on.
```

---

## Prompting habits that matter

**Do:**

- Give one workstream per session; `/clear` between them
- Ask for the plan before the code on anything non-trivial
- Reference plan sections by number — it can grep the file
- Make "done" a runnable command, not a feeling
- Commit at the end of every session while context is fresh
- When it goes wrong, `git reset` and re-prompt better rather than
  patching on top of a bad foundation

**Don't:**

- Paste the whole plan into the chat — put it in the repo
- Say "implement the plan" or "build the app"
- Let one session sprawl across mobile, API and database at once
- Accept "done" without running the tests yourself
- Let it invent conventions — that's what CLAUDE.md is for

---

## The one habit worth most

End each session with:

```
Update CLAUDE.md with any conventions we established today, and append
a short entry to docs/build-log.md: what we built, what's still open,
and what the next session should pick up.
```

Context doesn't survive between sessions. The repo does.
