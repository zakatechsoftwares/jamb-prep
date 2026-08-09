DROP INDEX IF EXISTS review_decisions_late_arrival_idx;
ALTER TABLE review_decisions DROP COLUMN IF EXISTS decision_context;
