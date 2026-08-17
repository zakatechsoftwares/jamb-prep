-- Reverses 0021 in the opposite order to the up migration.

ALTER TABLE reviewer_earnings
  DROP CONSTRAINT IF EXISTS reviewer_earnings_source_consistency;

ALTER TABLE reviewer_earnings DROP COLUMN IF EXISTS brief_item_id;

-- Restoring NOT NULL fails if any row was inserted with review_decision_id
-- NULL (a contributor-fee row) since this migration was applied -- the
-- same deliberate failure mode as 0012's risk_tier down-migration: retire
-- those rows first rather than silently reinterpreting them.
ALTER TABLE reviewer_earnings ALTER COLUMN review_decision_id SET NOT NULL;

DROP INDEX IF EXISTS items_brief_id_idx;
ALTER TABLE items DROP COLUMN IF EXISTS brief_id;

DROP TABLE IF EXISTS briefs;

ALTER TABLE objectives
  DROP COLUMN IF EXISTS requires_human_authorship,
  DROP COLUMN IF EXISTS target_item_count;
