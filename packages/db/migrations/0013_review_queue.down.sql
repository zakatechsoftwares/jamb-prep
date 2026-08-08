-- Reverses 0013 in the opposite order to the up migration.

DROP INDEX IF EXISTS review_claims_live_idx;
DROP INDEX IF EXISTS review_decisions_reviewer_item_idx;
DROP INDEX IF EXISTS items_review_queue_idx;

ALTER TABLE items DROP COLUMN IF EXISTS gate_flagged;

DROP TABLE IF EXISTS review_queue_configs;
