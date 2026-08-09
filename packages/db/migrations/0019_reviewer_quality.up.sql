-- Reviewer quality assurance (plan 7.11): gold-item scoring and accuracy
-- thresholds. gold_items and moderator_audits already exist (migration
-- 0012); this adds what actually scores a decision against a gold item and
-- what tracks a reviewer's accuracy-threshold streak.

-- 1. Gold-item scoring ----------------------------------------------------

-- One row per decision made on a seeded gold item (7.11) — the continuous,
-- silent accuracy signal. Never surfaced through any reviewer-facing
-- response; also a durable audit trail, so "which specific gold items has
-- this reviewer gotten wrong" (and "do many different reviewers fail the
-- same gold item", which would point at the reference itself) can be
-- investigated later without recomputing from review_decisions each time.
CREATE TABLE gold_item_scores (
  id BIGSERIAL PRIMARY KEY,
  item_id BIGINT NOT NULL REFERENCES items (id) ON DELETE RESTRICT,
  reviewer_id BIGINT NOT NULL REFERENCES reviewers (id) ON DELETE RESTRICT,
  review_decision_id BIGINT NOT NULL UNIQUE REFERENCES review_decisions (id) ON DELETE RESTRICT,
  agreed BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX gold_item_scores_reviewer_idx ON gold_item_scores (reviewer_id, created_at);

-- Append-only, same reasoning as review_decisions: a scoring event is a
-- historical fact, not a row to revise.
CREATE FUNCTION forbid_gold_item_scores_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'gold_item_scores is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER gold_item_scores_forbid_update
BEFORE UPDATE ON gold_item_scores
FOR EACH ROW EXECUTE FUNCTION forbid_gold_item_scores_mutation();

CREATE TRIGGER gold_item_scores_forbid_delete
BEFORE DELETE ON gold_item_scores
FOR EACH ROW EXECUTE FUNCTION forbid_gold_item_scores_mutation();

-- 2. Accuracy-threshold streak ---------------------------------------------

-- How many *consecutive* below-threshold checks this reviewer currently
-- has (packages/shared/accuracy-threshold-policy.ts's own state) — reset
-- to 0 on any check at or above threshold. A single dip recalibrates;
-- reaching the configured sustained-failure count deactivates.
ALTER TABLE reviewers
  ADD COLUMN consecutive_low_accuracy_count INTEGER NOT NULL DEFAULT 0
    CHECK (consecutive_low_accuracy_count >= 0);

-- 3. Accuracy threshold configuration ---------------------------------------

-- Versioned like review_queue_configs and payment_rate_configs.
CREATE TABLE accuracy_threshold_configs (
  id BIGSERIAL PRIMARY KEY,
  version INTEGER NOT NULL UNIQUE,

  threshold_rate NUMERIC(4, 3) NOT NULL CHECK (threshold_rate BETWEEN 0 AND 1),
  sustained_failure_count INTEGER NOT NULL CHECK (sustained_failure_count >= 1),

  active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX accuracy_threshold_configs_one_active_idx ON accuracy_threshold_configs (active)
WHERE active;

CREATE TRIGGER accuracy_threshold_configs_set_updated_at
BEFORE UPDATE ON accuracy_threshold_configs
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO accuracy_threshold_configs (version, threshold_rate, sustained_failure_count, active)
VALUES (1, 0.800, 3, true);
