DROP TABLE IF EXISTS accuracy_threshold_configs;

ALTER TABLE reviewers DROP COLUMN IF EXISTS consecutive_low_accuracy_count;

DROP TRIGGER IF EXISTS gold_item_scores_forbid_delete ON gold_item_scores;
DROP TRIGGER IF EXISTS gold_item_scores_forbid_update ON gold_item_scores;
DROP FUNCTION IF EXISTS forbid_gold_item_scores_mutation();
DROP TABLE IF EXISTS gold_item_scores;
