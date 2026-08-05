# CLAUDE.md — JAMB UTME Prep App

Persistent context for Claude Code. Read this before any task in this repo.

## What we are building

An offline-first JAMB UTME preparation app: mobile client (React Native/Expo,
Android first), Node + TypeScript backend, PostgreSQL, plus an internal content
pipeline that generates and reviews exam items.

The full specification lives at `docs/implementation-plan.docx` (and
`docs/implementation-plan.md` if converted). **That document is the source of
truth.** If anything here conflicts with it, the plan wins — raise the conflict
rather than guessing.

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
- Never push to main. Never push without showing me the diff first.
