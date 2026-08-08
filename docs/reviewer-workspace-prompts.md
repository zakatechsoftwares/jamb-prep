# Claude Code Prompts — Reviewer Workspace & Contributor Board

Phase 1 blocker. Build this **before** bulk generation.

Six sessions. `/clear` between each. Commit at the end of every one.

Prerequisites: sessions 1–2 of the main playbook done (monorepo scaffolded,
database schema and migrations in place, `docs/implementation-plan.md`
converted and in the repo).

> This document's `Session A`–`Session F` letters are its own numbering,
> independent of the main playbook's `Session 1`–`Session 5` and of this
> project's actual canonical sessions (`01`, `02`, …). See
> `docs/build-log.md`'s "Session order" table for how the two documents
> actually interleave in this repo — Session A here is canonical 04, not
> session A or 1.

---

## Session A — Item state machine and review domain model

```
GOAL: Implement the item lifecycle state machine and the review domain
tables. Pure data + logic, no UI.

CONTEXT: docs/implementation-plan.md section 7.10 defines eleven item
states and their transitions. Read it before starting.

BUILD:

1. Migration adding to the items table:
   - status (enum, the 11 states from 7.10)
   - independent_solve_verdict (enum: agreed | disagreed | not_run)
   - provenance jsonb: model id, prompt version, generated_at,
     raw_response_ref
   - risk_tier (enum: low | high | not_generated) — derived at
     generation from subject + whether the item contains a calculation

2. New tables:
   - reviewers        (id, subjects[], status, accuracy_score,
                       activated_at, bank_details_ref)
   - review_decisions (id, item_id, reviewer_id, action, rejection_reason,
                       reviewer_answer, seconds_taken, created_at)
   - review_claims    (item_id, reviewer_id, claimed_at, expires_at)
   - gold_items       (item_id, reference_decision, reference_key,
                       planted_error_type)
   - moderator_audits (id, item_id, moderator_id, agreed, note, created_at)

3. A pure state machine module in packages/shared:
   transition(currentState, event, context) -> newState | error

   Encode these rules as guards, not as comments:
   - high risk_tier can NEVER go straight from pending_review to
     approved_uncalibrated on a single decision — it must pass through
     needs_second_review
   - independent_solve_verdict = 'disagreed' forces needs_second_review
     regardless of tier
   - a reviewer may not decide on an item they authored (check
     items.contributor_id)
   - two conflicting decisions route to escalated, never to approved
   - only a moderator role may resolve escalated

CONSTRAINTS:
- review_decisions is append-only. Add a DB guard against UPDATE/DELETE,
  same pattern as the attempts table.
- Every transition writes actor id and timestamp. Full audit trail for any
  item a candidate ever queries.

DONE WHEN: the state machine has exhaustive unit tests covering every legal
transition and, importantly, every illegal one — especially the four guard
rules above, each with a test asserting it throws.

Write the tests first and show them to me before implementing.
```

---

## Session B — Queue assignment service

The subtle session. Get it wrong and reviewers cherry-pick or collide.

```
GOAL: The service that decides which item a given reviewer sees next.

CONTEXT: docs/implementation-plan.md sections 7.9 and 7.11.

BUILD a `getNextItem(reviewerId)` service in apps/api:

Priority order (highest first):
  1. items where independent_solve_verdict = 'disagreed'
  2. high risk_tier items (all calculation items)
  3. items in needs_second_review
  4. items flagged by other automated gates
  5. low risk_tier sampling — only the configured sample percentage of
     each batch enters the queue at all

Rules:
- The reviewer NEVER chooses. No item list, no browse, no filter. One item,
  assigned. This prevents cherry-picking of easy items.
- Only items matching the reviewer's subjects[].
- Never an item the reviewer has already decided on, or authored.
- For needs_second_review, never the same reviewer as the first decision.
- Claim the item for a configured period; expired claims return to the
  queue automatically via a background job.
- Inject seeded gold items at the configured rate, indistinguishable from
  ordinary items in the API response.
- Batch endpoint: return N items at once for offline caching (session D).

CONSTRAINTS:
- Concurrency-safe. Two reviewers hitting the endpoint simultaneously must
  never receive the same item — use SELECT ... FOR UPDATE SKIP LOCKED.
- The gold-item rate and the low-risk sample percentage are configuration
  values, not constants.

DONE WHEN: a test spawns 20 concurrent getNextItem calls and asserts 20
distinct items; plus tests for each priority rule and each exclusion rule.

Propose your locking approach before writing code.
```

---

## Session C — Review submission and the answer-before-key flow

```
GOAL: The decision endpoint, with the anti-anchoring control.

CONTEXT: section 7.10 "Review rules" in the plan.

THE CRITICAL BEHAVIOUR:
For any item with risk_tier = 'high', the API response for
getNextItem MUST NOT include correct_option, explanation, or
distractor_rationale. The reviewer submits their own answer first
(POST /review/:itemId/solve), and only then does a second call return the
proposed key, the explanation and the machine's verdict, along with whether
the reviewer agreed.

This is not a UI convention to be enforced client-side. Withhold the key at
the API layer. Seeing the proposed key first anchors the reviewer to it,
which is precisely how a confidently-wrong generated item survives review.

BUILD:
- POST /review/:itemId/solve  { answer }  -> stores reviewer_answer
- GET  /review/:itemId/reveal -> key, explanation, verdict, agreement flag
  (403 if risk_tier is high and no reviewer_answer recorded)
- POST /review/:itemId/decide { action, rejectionReason?, edits? }

Actions: approve | edit_and_approve | reject | escalate. Exactly four.
There is deliberately NO bulk approve endpoint — it is the mechanism by
which review becomes rubber-stamping. Do not add one even if it seems
convenient later.

Rejection reasons are a fixed enum, never free text:
  wrong_key | ambiguous_stem | implausible_distractor | off_syllabus |
  duplicate | style_breach | requires_diagram | factually_wrong

edit_and_approve accepts a patch to stem, options, key, explanation or
objective_id, and records the diff in review_decisions.

DONE WHEN: tests assert that a high-tier item's key cannot be retrieved
before solving, that the four actions each drive the correct state
transition, and that free-text rejection reasons are rejected by validation.
```

---

## Session D — The reviewer workspace UI

```
GOAL: The reviewer-facing app in apps/admin. Mobile-first.

CONTEXT: section 7.9 of the plan. Read it fully — the capability table
there is the spec.

DESIGN ASSUMPTION, and every decision follows from it: reviewers are
practising Nigerian teachers working evenings on their own phones, on
unreliable connectivity, in five-minute bursts between other commitments.
Not on a desktop. Not with a stable connection. Not for an hour at a time.

BUILD:
- Single-item view, everything on one screen without scrolling on a
  360px-wide device where possible
- For high-tier items: solve step first (tap A/B/C/D, submit), then the
  reveal showing proposed key, explanation, machine verdict, and whether
  the reviewer agreed — with disagreement visually prominent
- Four action buttons, large touch targets, thumb-reachable at the bottom
- Rejection reason as a single tap from the fixed enum
- Inline edit without leaving the item
- Keyboard shortcuts on desktop: A–D to select, 1–4 for actions, Enter to
  confirm, Esc to cancel
- Persistent header: items reviewed today, running accuracy, earnings
  accrued this week

DO NOT BUILD: an item list, a search, a filter, a "skip to next subject"
control, or any way to see the queue. The reviewer gets one item.

CONSTRAINTS:
- Works at 360px width
- No layout shift when the reveal step appears — reserve the space
- Follows the design tokens in the frontend-design skill

DONE WHEN: the full flow works end to end against the real API for both a
low-tier and a high-tier item, and I can drive it entirely by keyboard on
desktop and entirely by thumb on a 360px viewport.
```

---

## Session E — Offline layer for the workspace

```
GOAL: Make the workspace usable with no connection.

CONTEXT: section 7.9, "Offline capable". Mirror the architecture the
candidate app uses (section 8.3) — same idempotency discipline.

BUILD:
- Service worker caching the app shell
- On connect: prefetch a batch of claimed items into IndexedDB, with claim
  expiry timestamps stored alongside
- Decisions written locally first, queued with idempotency keys, uploaded
  on reconnection
- Clear UI state: how many items are cached, how many decisions are pending
  upload, when the claims expire
- Conflict case: a claim expired while offline and the item was reassigned.
  The decision is still recorded as a second opinion, never silently
  discarded and never overwriting the other reviewer's decision.

DONE WHEN: tests cover — review 10 items fully offline then sync; the same
decision batch uploaded three times produces one set of rows; a decision
submitted against an expired claim is retained as a second opinion.
```

---

## Session F — Gold items, audit, and payment accrual

```
GOAL: Close the quality loop and the money loop.

CONTEXT: section 7.11 of the plan.

BUILD:

1. Gold item scoring: when a reviewer decides on a gold item, compare to
   the reference decision and update their rolling accuracy. Silent — the
   reviewer is never told which items were gold.

2. Moderator audit queue: a random weekly sample of each reviewer's
   approvals, re-reviewed by the subject moderator, agreement recorded.

3. Accuracy thresholds: below threshold triggers re-calibration
   (re-issue the 30-item calibration set); sustained failure deactivates
   the reviewer AND re-queues their recent approvals for re-review.

4. Inter-rater agreement per subject. Surface it as a CONTENT signal, not
   a reviewer signal — persistently low agreement means ambiguous items or
   unclear guidance, and should be investigated as a content problem first.

5. Payment accrual: earnings per decision, at a higher rate for high-tier
   and second-review items. Rejections accrue at the SAME rate as
   approvals — this removes the incentive to wave items through, and it is
   deliberate, so do not "optimise" it later.

6. Weekly payment run: generate a bank transfer batch file from the review
   log, mark decisions as paid, produce a per-reviewer statement.

7. Content lead dashboard: accepted items per reviewer-hour (the metric the
   content budget depends on), rejection reasons aggregated by subject and
   week, queue depth, items by state, cost per approved item split into
   inference cost and reviewer fees.

DONE WHEN: the dashboard renders live data from a seeded database, and the
rejection-reason aggregation makes it obvious at a glance which prompt
defect to fix next.
```

---

## Then: the contributor brief board

```
GOAL: The commissioning side, per section 7.12.

BUILD in apps/admin:
- Gap detection: compare approved item counts per syllabus objective
  against target volumes, flag objectives that generation cannot fill
  (diagram-dependent, reading text, time-sensitive)
- Brief creation from a template: objective, count, difficulty spread,
  cognitive levels, style notes, fee, deadline
- Open brief board — contributors claim what suits them
- Structured authoring form producing the SAME item schema as generated
  items: stem, four options, key, distractor_rationale, explanation,
  method_steps, objective_id. No file uploads, no Word documents, no
  format conversion anywhere in this flow.
- Diagram request: contributor describes the figure and uploads a phone
  photo of a hand sketch, creating an illustration ticket rather than
  blocking the item
- Illustrator queue: ticket in, SVG out, against the accessibility spec
  (scalable, legible at small sizes, monochrome-safe, alt text required)
- Contributed items enter the ordinary review queue, reviewed by someone
  who is not the author
- Fees join the same weekly payment run as reviewer earnings

CONSTRAINT: contributors and reviewers are ONE pool with one account, one
payment record and one quality history. The same teacher reviews Chemistry
in October and takes a diagram brief in March. Do not build two user models.

DONE WHEN: a brief can be created from a detected gap, claimed, authored,
illustrated, reviewed and paid — end to end in a test.
```

---

## Session-closing prompt (use every time)

```
Update CLAUDE.md with any conventions we established today, and append to
docs/build-log.md: what we built, what's still open, and what the next
session should pick up. Then run the full test suite and show me the result.
```

---

## Guard rails — restate these if Claude Code drifts

Four things it will be tempted to "helpfully" add. Refuse each:

| It will suggest                                  | Why to refuse                                                     |
| ------------------------------------------------ | ----------------------------------------------------------------- |
| A bulk-approve button                            | This is how review becomes rubber-stamping                        |
| An item list or queue browser                    | Enables cherry-picking of easy items                              |
| Showing the key alongside the item for high-tier | Anchoring is the whole failure mode                               |
| Free-text rejection notes                        | Unusable in aggregate; kills the feedback loop into the generator |

If it adds any of these, `git reset` and re-prompt rather than removing them
after the fact — they tend to leave assumptions behind in adjacent code.
