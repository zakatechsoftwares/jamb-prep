# @jamb/shared

Types and pure logic shared between the client and server. No `apps/*`
package may reimplement anything that belongs here — see CLAUDE.md's "no
business logic in apps/mobile" rule.

## Scoring (`src/scoring.ts`)

Computes per-subject and aggregate exam scores from an `ExamConfig` and a
list of attempts. Pure and dependency-free: no DB access, no I/O. All item
counts and marks come from the `ExamConfig` passed in — nothing about the
current exam blueprint (60/40 items, 100 marks per subject, 400 aggregate)
is hard-coded, because the blueprint is versioned data (plan section 8.4),
not application logic.

**Rounding rule — pending verification against a real UTME result slip:**
each subject's score is rounded to the nearest whole mark, half rounding up
(`12.5 → 13`). The aggregate is the _sum of the already-rounded_ subject
scores, not a separately-rounded sum of raw fractions — this matches how a
UTME result slip reports a whole number per subject, with the total simply
adding those up. This is a design decision, not a value taken from the
plan document; confirm it against an actual result slip before this is
treated as settled.

**No negative marking, by design, not by config.** `ExamConfig` has no
`negativeMarking` field. The blueprint (plan section 3) never applies
negative marking, and this module encodes that as a fixed invariant of the
scoring algorithm rather than a togglable option — a wrong or unanswered
item always scores exactly 0, never a deduction. If JAMB ever introduces
negative marking, that's a new scoring algorithm, not a flag on this one;
adding a field for it later is a schema change every caller would notice,
which is the point — a field nobody reads is a risk nobody notices.

**`sequence` and how it maps onto the `attempts` table.** `ScoringAttempt`
orders re-answers of the same item with a plain `sequence: number` — higher
wins, and it must be unique per item. Callers should derive it from the
`attempts` table (`packages/db/migrations/0008_attempts.up.sql`) queried
`ORDER BY created_at ASC, id ASC`, because `created_at` alone can tie — two
answers submitted inside the same offline-sync batch can land in the same
millisecond — so the primary key `id` is the real tiebreak. `scoreExam`
never sees `created_at` or `id`: if two attempts for the same item arrive
with an equal `sequence`, it throws rather than guessing which one is
actually latest.
