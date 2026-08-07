-- Reverses 0012 in the opposite order to the up migration.

DROP TABLE IF EXISTS item_state_transitions;
DROP FUNCTION IF EXISTS forbid_item_state_transitions_mutation();

DROP TABLE IF EXISTS moderator_audits;
DROP TABLE IF EXISTS gold_items;
DROP TABLE IF EXISTS review_claims;

DROP TABLE IF EXISTS review_decisions;
DROP FUNCTION IF EXISTS forbid_review_decisions_mutation();

DROP TABLE IF EXISTS reviewers;

DROP INDEX IF EXISTS items_approval_route_idx;
DROP INDEX IF EXISTS items_contributor_id_idx;

ALTER TABLE items
  DROP COLUMN IF EXISTS sampled_for_review,
  DROP COLUMN IF EXISTS contributor_id;

-- Restoring the two-value risk_tier constraint FAILS if any item has been
-- tiered 'not_generated' since this migration was applied. That is
-- deliberate: the alternative is to silently relabel human-authored items as
-- generated ones, which is exactly the kind of quiet data corruption the
-- constraint exists to prevent. Retire or retier those items first.
ALTER TABLE items DROP CONSTRAINT items_risk_tier_check;

ALTER TABLE items
  ADD CONSTRAINT items_risk_tier_check CHECK (risk_tier IN ('low', 'high'));

ALTER TABLE items DROP CONSTRAINT items_independent_solve_verdict_check;

ALTER TABLE items
  ALTER COLUMN independent_solve_verdict DROP DEFAULT,
  ALTER COLUMN independent_solve_verdict DROP NOT NULL;

UPDATE items SET independent_solve_verdict = NULL WHERE independent_solve_verdict = 'not_run';

ALTER TABLE items
  ADD CONSTRAINT items_independent_solve_verdict_check
    CHECK (independent_solve_verdict IN ('agreed', 'disagreed'));
