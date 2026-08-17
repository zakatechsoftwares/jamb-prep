-- The contributor brief board (plan 7.12, canonical session 11, Phase 1 —
-- text items only; the diagram/illustration sub-flow is a follow-up
-- session). Gap detection, brief creation/claiming, and a contributor-fee
-- path through the existing reviewer_earnings table.

-- 1. Coverage-gap detection targets ---------------------------------------

-- Set by the content lead per objective as they scope coverage. NULL means
-- "no target set" -- excluded from gap detection entirely, not treated as
-- a target of zero.
ALTER TABLE objectives
  ADD COLUMN target_item_count INTEGER CHECK (target_item_count IS NULL OR target_item_count > 0),
  -- Whether generation can never fill this objective at all (diagram-
  -- dependent, reading text, current-affairs/policy) -- the plan 7.12
  -- category that must always be commissioned, not just under target.
  ADD COLUMN requires_human_authorship BOOLEAN NOT NULL DEFAULT false;

-- 2. Briefs ----------------------------------------------------------------

CREATE TABLE briefs (
  id BIGSERIAL PRIMARY KEY,
  objective_id BIGINT NOT NULL REFERENCES objectives (id) ON DELETE RESTRICT,
  item_count INTEGER NOT NULL CHECK (item_count > 0),
  -- Descriptive guidance for the contributor, not queried on -- JSONB,
  -- matching the existing rate_basis/provenance precedent for this shape.
  difficulty_spread JSONB NOT NULL,
  cognitive_levels JSONB NOT NULL,
  style_notes TEXT,
  fee_kobo BIGINT NOT NULL CHECK (fee_kobo >= 0),
  deadline TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'claimed', 'completed')),
  created_by BIGINT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  claimed_by BIGINT REFERENCES users (id) ON DELETE RESTRICT,
  claimed_at TIMESTAMPTZ,
  CONSTRAINT briefs_claim_consistency CHECK ((claimed_by IS NULL) = (claimed_at IS NULL)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX briefs_status_idx ON briefs (status);
CREATE INDEX briefs_objective_id_idx ON briefs (objective_id);

CREATE TRIGGER briefs_set_updated_at
BEFORE UPDATE ON briefs
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 3. Items gain a brief reference -------------------------------------------

ALTER TABLE items ADD COLUMN brief_id BIGINT REFERENCES briefs (id) ON DELETE RESTRICT;
CREATE INDEX items_brief_id_idx ON items (brief_id);

-- 4. reviewer_earnings gains a second, mutually exclusive source -----------

-- Every earnings row today is strictly one-to-one with a review_decisions
-- row. A contributor's authoring fee has no review_decisions row to
-- reference -- it is paid per item, on that item's approval, keyed to the
-- item itself instead. Exactly one of the two sources must be set; a row
-- paid for a decision is never also a contributor fee, or vice versa.
ALTER TABLE reviewer_earnings
  ALTER COLUMN review_decision_id DROP NOT NULL,
  ADD COLUMN brief_item_id BIGINT UNIQUE REFERENCES items (id) ON DELETE RESTRICT,
  ADD CONSTRAINT reviewer_earnings_source_consistency
    CHECK (num_nonnulls(review_decision_id, brief_item_id) = 1);
