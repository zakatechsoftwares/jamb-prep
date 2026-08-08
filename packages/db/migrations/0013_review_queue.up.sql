-- The reviewer queue: configuration and the gate flag it prioritises on.
-- Plan sections 7.9 and 7.11.

-- 1. Queue configuration ----------------------------------------------------

-- Versioned like exam_configs, for the same reason: the gold-item rate and
-- the sampling rate are operating decisions that change between generation
-- waves, and changing one must not require a release.
CREATE TABLE review_queue_configs (
  id BIGSERIAL PRIMARY KEY,
  version INTEGER NOT NULL UNIQUE,

  -- Rates in [0, 1], never percentages. Plan 7.3's "30-50%" is 0.3-0.5
  -- here; packages/shared/src/review-queue-policy.ts throws on anything
  -- outside the range, and so does the CHECK below.
  gold_item_rate NUMERIC(4, 3) NOT NULL CHECK (gold_item_rate BETWEEN 0 AND 1),
  low_risk_sample_rate NUMERIC(4, 3) NOT NULL CHECK (low_risk_sample_rate BETWEEN 0 AND 1),

  claim_duration_minutes INTEGER NOT NULL CHECK (claim_duration_minutes > 0),
  batch_max_size INTEGER NOT NULL CHECK (batch_max_size > 0),

  active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Exactly one active configuration at a time: "which config is live" must
-- never be a question the application answers by picking a row.
CREATE UNIQUE INDEX review_queue_configs_one_active_idx ON review_queue_configs (active)
WHERE active;

CREATE TRIGGER review_queue_configs_set_updated_at
BEFORE UPDATE ON review_queue_configs
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO review_queue_configs (
  version, gold_item_rate, low_risk_sample_rate,
  claim_duration_minutes, batch_max_size, active
) VALUES (1, 0.05, 0.300, 30, 25, true);

-- 2. The gate flag ----------------------------------------------------------

-- Priority band 4 in 7.9: "items flagged by other automated gates". The
-- status an item failed a gate in (gate_failed) is a state it leaves, so it
-- cannot carry the fact forward — hence a flag on the row.
--
-- Written only in the same transaction as the routed_for_judgement
-- transition, never separately, so the flag and item_state_transitions
-- cannot disagree. review-queue-repository.ts is the only writer, and
-- gate-flag-agreement.integration.test.ts proves they agree.
ALTER TABLE items ADD COLUMN gate_flagged BOOLEAN NOT NULL DEFAULT false;

-- 3. Gold stock-out counter -------------------------------------------------

-- Recorded whenever the gold-injection draw fires but no eligible gold item
-- exists for that reviewer (7.11).
--
-- Running out of gold stock is silent by construction: the reviewer is
-- served an ordinary item and notices nothing, the API returns success, and
-- accuracy measurement simply stops happening. Nothing else in the system
-- would ever surface it. One row per occurrence rather than a bare integer,
-- so the content lead's dashboard can tell a global stock-out from one
-- reviewer who has already seen every gold item in their subjects — which
-- are different problems with different fixes.
CREATE TABLE review_queue_gold_stockouts (
  id BIGSERIAL PRIMARY KEY,
  reviewer_id BIGINT NOT NULL REFERENCES reviewers (id) ON DELETE CASCADE,
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX review_queue_gold_stockouts_occurred_at_idx
  ON review_queue_gold_stockouts (occurred_at);
CREATE INDEX review_queue_gold_stockouts_reviewer_idx
  ON review_queue_gold_stockouts (reviewer_id, occurred_at);

-- 4. Queue scan support -----------------------------------------------------

-- The queue only ever scans the two waiting states, so a partial index keeps
-- it off the whole bank. Ordered to match the ORDER BY in the claim query
-- (band, then oldest first) as closely as an index can.
CREATE INDEX items_review_queue_idx ON items (subject_id, created_at, id)
WHERE status IN ('pending_review', 'needs_second_review');

-- Reviewer exclusion checks: "has this reviewer already decided on this
-- item" runs once per candidate row considered.
CREATE INDEX review_decisions_reviewer_item_idx ON review_decisions (reviewer_id, item_id);

-- Sweeping expired claims, and the not-currently-claimed check.
CREATE INDEX review_claims_live_idx ON review_claims (item_id, expires_at);
