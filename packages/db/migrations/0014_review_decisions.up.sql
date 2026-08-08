-- The decision endpoint: plan 7.10's anti-anchoring control and the
-- edit_and_approve diff. Migrations 0012 and 0013 are merged; this is
-- additive rather than an amendment.

-- 1. Recording the blind answer before reveal -------------------------------

-- The reviewer's own answer, entered before the proposed key is ever
-- revealed (7.10) — the single highest-value control in the framework.
-- Lives on the claim, not on review_decisions: solve happens before a
-- decision exists at all, and decide later copies this value into
-- review_decisions.reviewer_answer for the permanent record.
ALTER TABLE review_claims
  ADD COLUMN reviewer_answer TEXT CHECK (reviewer_answer IN ('A', 'B', 'C', 'D'));

-- Write-once within one claim episode. A claim episode is identified by
-- claimed_at: claiming (or reclaiming an item whose previous claim expired)
-- always sets a fresh claimed_at, so an UPDATE that changes claimed_at is
-- "this is a new claim, start blind again" — legitimate, and how the
-- repository resets reviewer_answer to NULL when an expired claim is
-- picked up again, so a stale answer from a timed-out reviewer can never
-- leak to whoever claims the item next.
--
-- An UPDATE that leaves claimed_at unchanged and tries to change an
-- already-recorded answer is a reviewer who has seen the key rewriting
-- their blind answer to agree with it, which would make their accuracy
-- score (7.11) fiction. That is blocked here, at the database, for the
-- same reason review_decisions is append-only at the database and not
-- only by application discipline: the control is not a UI convention.
CREATE FUNCTION forbid_reviewer_answer_rewrite()
RETURNS trigger AS $$
BEGIN
  IF OLD.reviewer_answer IS NOT NULL
     AND NEW.claimed_at = OLD.claimed_at
     AND NEW.reviewer_answer IS DISTINCT FROM OLD.reviewer_answer THEN
    RAISE EXCEPTION 'review_claims.reviewer_answer is immutable once recorded for a claim';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER review_claims_forbid_reviewer_answer_rewrite
BEFORE UPDATE ON review_claims
FOR EACH ROW EXECUTE FUNCTION forbid_reviewer_answer_rewrite();

-- 2. The edit_and_approve diff -----------------------------------------------

-- What changed, when a reviewer edits and approves (7.9's "inline
-- editing"). An audit blob, not syllabus data, so JSONB is fine here — the
-- same reasoning as items.provenance.
ALTER TABLE review_decisions
  ADD COLUMN edit_diff JSONB;

ALTER TABLE review_decisions
  ADD CONSTRAINT review_decisions_edit_diff_required
    CHECK ((action = 'edit_and_approve') = (edit_diff IS NOT NULL));
