-- The offline reviewer workspace (7.9/8.3, session 08): a decision queued
-- while offline can reach the server after its claim expired and was
-- reassigned to a different reviewer. That decision is never discarded and
-- never overwrites the item's authoritative state — it is recorded as an
-- audit-only second opinion instead. 'decision_context' is the positive
-- flag that marks those rows, rather than leaving it to be inferred from
-- the absence of a state transition, so a later query (7.11's inter-rater
-- agreement) can select on it directly.
ALTER TABLE review_decisions
  ADD COLUMN decision_context TEXT NOT NULL DEFAULT 'live'
    CHECK (decision_context IN ('live', 'late_arrival'));

-- Late arrivals are expected to stay rare; a partial index keeps the
-- lookup cheap without carrying the overwhelmingly common 'live' rows.
CREATE INDEX review_decisions_late_arrival_idx ON review_decisions (item_id)
  WHERE decision_context = 'late_arrival';
