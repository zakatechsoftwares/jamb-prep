# @jamb/shared

Types and pure logic shared between the client and server. No `apps/*`
package may reimplement anything that belongs here — see CLAUDE.md's "no
business logic in apps/mobile" rule.

## The item lifecycle vocabulary (`src/item-lifecycle.ts`)

The single home for the enumerated values that plan sections 7.3–7.14
define: the eleven item states, approval routes, risk tiers, independent
solve verdicts, review actions, the structured rejection taxonomy, panel
roles and reviewer statuses. Declared here and nowhere else — `@jamb/db`
imports them rather than retyping them, and
`packages/db/src/lifecycle-vocabulary.test.ts` parses the migrations'
CHECK constraints and fails if the database and this file diverge.

## Item state machine (`src/item-state-machine.ts`)

`transition(currentState, event, context)` advances one item through the
lifecycle in plan section 7.10. Pure and dependency-free: no DB access, no
I/O, and no clock — the caller supplies `occurredAt`, because a pure
function that reads the wall clock is not reproducible in a test.

**It throws rather than returning a falsy result.** An illegal transition
is a bug in the caller, and an item reaching candidates by an illegitimate
path is the failure this module exists to make impossible. Silently
returning `null` would let that failure propagate to the row that gets
written.

**One table of legal source states.** `LEGAL_SOURCE_STATES` names, per
event, the states it may be applied from. `rejected` and `retired` appear
in no list, which is what makes them terminal — the absence of any way out,
not a special case in the code.

**`gates_passed` never promotes.** Passing the automated gates only ever
queues an item as `pending_review`, whatever its facts. The automated-only
route in 7.14 is reached solely through `auto_gate_promote`, which asserts
all three conditions (low risk tier, not sampled, independent solve agreed)
and throws if any fails. Two doors, deliberately: skipping human review is
a decision a caller has to take on purpose, not an outcome it can fall into
by passing the wrong context. This is why the route is not simply derived
from the item's fields.

**What the returned object carries, and why it isn't just a state.**
`TransitionResult` returns the new status _plus_ the `approvalRoute` the
transition establishes and the actor and timestamp it must be recorded
against. The route is determined by the transition and nothing else —
deriving it at the call site would re-implement the 7.14 rule in a second
place. A `null` route means "this transition establishes no route; leave
the item's existing one alone", not "clear it".

**Guards, encoded as guards rather than comments.** A high `risk_tier`
item never reaches `approved_uncalibrated` on one decision; a `disagreed`
independent solve forces a second review regardless of tier; nobody decides
on an item they authored (on rejection as much as on approval, and
moderators included, since they are drawn from the same pool); conflicting
decisions route to `escalated` and never to approved; only a moderator
resolves an escalation; and a reviewer may not decide twice on one item,
because 7.10's second opinion is a second _independent_ reviewer.

**An expired claim returns to the queue it came from.** `claim_expired`
routes to `needs_second_review` when a prior decision exists, not to
`pending_review` — otherwise a lapsed second review could be approved by a
single reviewer, silently discarding the requirement that put it there.

**Where the audit trail is written.** The machine is pure and writes
nothing. Its result maps directly onto an `item_state_transitions` row
(migration `0012`), which is append-only. `review_decisions` records
reviewer decisions specifically; the transition log records every
transition including the automated ones.

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
