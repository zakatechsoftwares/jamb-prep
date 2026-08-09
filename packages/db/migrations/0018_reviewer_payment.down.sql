DROP TRIGGER IF EXISTS reviewer_earnings_forbid_rewrite ON reviewer_earnings;
DROP FUNCTION IF EXISTS forbid_reviewer_earnings_rewrite();
DROP TABLE IF EXISTS reviewer_earnings;

DROP TRIGGER IF EXISTS payment_batch_lines_forbid_delete ON payment_batch_lines;
DROP TRIGGER IF EXISTS payment_batch_lines_forbid_update ON payment_batch_lines;
DROP TABLE IF EXISTS payment_batch_lines;

DROP TRIGGER IF EXISTS payment_batches_forbid_delete ON payment_batches;
DROP TRIGGER IF EXISTS payment_batches_forbid_update ON payment_batches;
DROP FUNCTION IF EXISTS forbid_payment_batches_mutation();
DROP TABLE IF EXISTS payment_batches;

DROP TABLE IF EXISTS payment_rate_configs;
