-- Reverses 0014 in the opposite order to the up migration.

ALTER TABLE review_decisions
  DROP CONSTRAINT IF EXISTS review_decisions_edit_diff_required,
  DROP COLUMN IF EXISTS edit_diff;

DROP TRIGGER IF EXISTS review_claims_forbid_reviewer_answer_rewrite ON review_claims;
DROP FUNCTION IF EXISTS forbid_reviewer_answer_rewrite();

ALTER TABLE review_claims DROP COLUMN IF EXISTS reviewer_answer;
