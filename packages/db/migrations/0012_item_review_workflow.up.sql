-- The item lifecycle and the editorial review domain: plan sections 7.8-7.14.
--
-- Naming note: the `review_*` tables below are the EDITORIAL review of items
-- by the human panel. They have nothing to do with `review_queue_entries`
-- (migration 0009), which is the candidate-facing spaced-repetition queue.
--
-- Every enumerated value here is mirrored in packages/shared/src/item-lifecycle.ts,
-- which is the single home for this vocabulary. lifecycle-vocabulary.test.ts
-- parses this file and fails if the two ever drift apart.

-- 1. items: complete the lifecycle metadata --------------------------------

-- 'not_run' replaces NULL so that "the blind solve never ran" is a recorded
-- fact rather than an absence. Section 7.14 turns on the verdict being
-- exactly 'agreed', so "never ran" and "disagreed" must both read as
-- visibly ineligible for the automated route.
ALTER TABLE items DROP CONSTRAINT items_independent_solve_verdict_check;

UPDATE items SET independent_solve_verdict = 'not_run' WHERE independent_solve_verdict IS NULL;

ALTER TABLE items
  ALTER COLUMN independent_solve_verdict SET DEFAULT 'not_run',
  ALTER COLUMN independent_solve_verdict SET NOT NULL,
  ADD CONSTRAINT items_independent_solve_verdict_check
    CHECK (independent_solve_verdict IN ('agreed', 'disagreed', 'not_run'));

-- Section 7.3's third tier: diagram-dependent items, the recommended reading
-- text, and anything turning on current policy or office holders. These are
-- human-authored, never generated, and so can never take the automated route.
ALTER TABLE items DROP CONSTRAINT items_risk_tier_check;

ALTER TABLE items
  ADD CONSTRAINT items_risk_tier_check CHECK (risk_tier IN ('low', 'high', 'not_generated'));

ALTER TABLE items
  -- Who authored the item, when a human did (7.12). The self-review guard
  -- compares this against the deciding reviewer's user id: contributors and
  -- reviewers are one pool, but never on the same item (7.10, 7.13).
  ADD COLUMN contributor_id BIGINT REFERENCES users (id) ON DELETE RESTRICT,
  -- Whether the 7.3 sampling draw selected this item for human review. One
  -- of the three conditions of the automated-only route in 7.14, and not
  -- derivable after the fact, so it is recorded at generation.
  ADD COLUMN sampled_for_review BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX items_contributor_id_idx ON items (contributor_id);
CREATE INDEX items_approval_route_idx ON items (approval_route);

-- 2. The review panel -------------------------------------------------------

CREATE TABLE reviewers (
  id BIGSERIAL PRIMARY KEY,
  -- One account per person across every role they hold (7.13): the same
  -- teacher may review Chemistry and author a commissioned diagram set.
  user_id BIGINT NOT NULL UNIQUE REFERENCES users (id) ON DELETE RESTRICT,
  role TEXT NOT NULL DEFAULT 'reviewer'
    CHECK (role IN ('content_lead', 'moderator', 'reviewer', 'contributor')),
  -- Subjects this reviewer is calibrated for. Denormalised deliberately, as
  -- specified: array elements carry no FK integrity, so a subject may not be
  -- deleted on the strength of this table alone.
  subject_ids BIGINT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'applied'
    CHECK (status IN ('applied', 'calibrating', 'active', 'suspended', 'removed')),
  -- Rolling accuracy against gold items and moderator audits (7.11).
  accuracy_score NUMERIC(4, 3) CHECK (accuracy_score IS NULL OR accuracy_score BETWEEN 0 AND 1),
  activated_at TIMESTAMPTZ,
  -- Opaque reference into the payments store. Bank details are never held
  -- in this database.
  bank_details_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX reviewers_status_idx ON reviewers (status);

CREATE TRIGGER reviewers_set_updated_at
BEFORE UPDATE ON reviewers
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 3. Review decisions -------------------------------------------------------

CREATE TABLE review_decisions (
  id BIGSERIAL PRIMARY KEY,
  item_id BIGINT NOT NULL REFERENCES items (id) ON DELETE RESTRICT,
  reviewer_id BIGINT NOT NULL REFERENCES reviewers (id) ON DELETE RESTRICT,
  -- The four actions the workspace offers (7.9). Nothing else.
  action TEXT NOT NULL CHECK (action IN ('approve', 'edit_and_approve', 'reject', 'escalate')),
  -- The structured taxonomy from 7.9, required on rejection and forbidden
  -- otherwise: free-text rejection notes are unusable in aggregate, and the
  -- whole point of the taxonomy is that it feeds prompt improvement.
  rejection_reason TEXT CHECK (rejection_reason IN (
    'wrong_key',
    'ambiguous_stem',
    'implausible_distractor',
    'off_syllabus',
    'duplicate',
    'style_breach',
    'requires_diagram',
    'factually_wrong'
  )),
  CONSTRAINT review_decisions_rejection_reason_required
    CHECK ((action = 'reject') = (rejection_reason IS NOT NULL)),
  -- The reviewer's own answer, entered before the proposed key is revealed
  -- (7.10). The single highest-value control in the framework.
  reviewer_answer TEXT CHECK (reviewer_answer IN ('A', 'B', 'C', 'D')),
  seconds_taken INTEGER NOT NULL CHECK (seconds_taken >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Present for schema consistency; the guard below blocks every UPDATE, so
  -- this is set once at insert and can never legitimately change.
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Idempotency key for the offline reviewer workspace (7.9): decisions are
  -- cached on the device and synced on reconnection, and a retry must never
  -- record the same decision twice.
  idempotency_key TEXT NOT NULL UNIQUE
);

CREATE INDEX review_decisions_item_id_idx ON review_decisions (item_id, created_at);
CREATE INDEX review_decisions_reviewer_id_idx ON review_decisions (reviewer_id);

-- A reviewer decides at most once per item: the second opinion in 7.10 is a
-- second *independent* reviewer, not the same person deciding twice.
CREATE UNIQUE INDEX review_decisions_one_per_reviewer_idx ON review_decisions (item_id, reviewer_id);

-- Review decisions are append-only, for the same reason attempts are: the
-- audit trail is the product. A reviewer who changes their mind records a
-- new decision; they never edit the old one. Same guard pattern as
-- migration 0008.
CREATE FUNCTION forbid_review_decisions_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'review_decisions is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER review_decisions_forbid_update
BEFORE UPDATE ON review_decisions
FOR EACH ROW EXECUTE FUNCTION forbid_review_decisions_mutation();

CREATE TRIGGER review_decisions_forbid_delete
BEFORE DELETE ON review_decisions
FOR EACH ROW EXECUTE FUNCTION forbid_review_decisions_mutation();

-- 4. Review claims ----------------------------------------------------------

-- One live claim per item, which is what makes the single-item queue in 7.9
-- work: the reviewer never chooses what to work on, so two reviewers must
-- never hold the same item. Expired claims are deleted, not retained — the
-- decision log, not the claim, is the audit record.
CREATE TABLE review_claims (
  item_id BIGINT PRIMARY KEY REFERENCES items (id) ON DELETE CASCADE,
  reviewer_id BIGINT NOT NULL REFERENCES reviewers (id) ON DELETE RESTRICT,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT review_claims_expires_after_claim CHECK (expires_at > claimed_at)
);

CREATE INDEX review_claims_reviewer_id_idx ON review_claims (reviewer_id);
CREATE INDEX review_claims_expires_at_idx ON review_claims (expires_at);

CREATE TRIGGER review_claims_set_updated_at
BEFORE UPDATE ON review_claims
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 5. Gold items -------------------------------------------------------------

-- Seeded items with known reference decisions, including planted wrong keys
-- (7.11). Reviewer accuracy is measured continuously and invisibly against
-- these, so nothing here may ever be exposed through a reviewer-facing API.
CREATE TABLE gold_items (
  item_id BIGINT PRIMARY KEY REFERENCES items (id) ON DELETE CASCADE,
  reference_decision TEXT NOT NULL CHECK (reference_decision IN ('approve', 'reject', 'escalate')),
  reference_key TEXT NOT NULL CHECK (reference_key IN ('A', 'B', 'C', 'D')),
  -- NULL for a deliberately clean gold item: a calibration set made only of
  -- broken items teaches reviewers to reject everything.
  planted_error_type TEXT CHECK (planted_error_type IN (
    'wrong_key',
    'ambiguous_stem',
    'implausible_distractor',
    'off_syllabus',
    'duplicate',
    'style_breach',
    'requires_diagram',
    'factually_wrong'
  )),
  CONSTRAINT gold_items_planted_error_matches_decision
    CHECK ((reference_decision = 'approve') = (planted_error_type IS NULL)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER gold_items_set_updated_at
BEFORE UPDATE ON gold_items
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 6. Moderator audits -------------------------------------------------------

-- The subject moderator re-reviews a random sample of each reviewer's
-- approvals each week (7.11).
CREATE TABLE moderator_audits (
  id BIGSERIAL PRIMARY KEY,
  item_id BIGINT NOT NULL REFERENCES items (id) ON DELETE RESTRICT,
  moderator_id BIGINT NOT NULL REFERENCES reviewers (id) ON DELETE RESTRICT,
  -- Whether the moderator agreed with the decision under audit.
  agreed BOOLEAN NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX moderator_audits_item_id_idx ON moderator_audits (item_id);
CREATE INDEX moderator_audits_moderator_id_idx ON moderator_audits (moderator_id, created_at);

CREATE TRIGGER moderator_audits_set_updated_at
BEFORE UPDATE ON moderator_audits
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 7. The state transition log -----------------------------------------------

-- "States are recorded with actor and timestamp, giving a complete audit
-- trail for any item a candidate ever queries" (7.10). review_decisions
-- records only reviewer decisions; this records every transition, including
-- the automated ones — gate failures, auto-gated promotion, calibration,
-- automatic quarantine — which is what makes the trail complete.
CREATE TABLE item_state_transitions (
  id BIGSERIAL PRIMARY KEY,
  item_id BIGINT NOT NULL REFERENCES items (id) ON DELETE RESTRICT,
  from_status TEXT NOT NULL CHECK (from_status IN (
    'generated',
    'gate_failed',
    'pending_review',
    'in_review',
    'needs_second_review',
    'escalated',
    'approved_uncalibrated',
    'approved_calibrated',
    'quarantined',
    'rejected',
    'retired'
  )),
  to_status TEXT NOT NULL CHECK (to_status IN (
    'generated',
    'gate_failed',
    'pending_review',
    'in_review',
    'needs_second_review',
    'escalated',
    'approved_uncalibrated',
    'approved_calibrated',
    'quarantined',
    'rejected',
    'retired'
  )),
  event TEXT NOT NULL,
  -- NULL for an automated transition; the pipeline is the actor and there is
  -- no user to name. A fabricated system user id would be worse than a NULL.
  actor_user_id BIGINT REFERENCES users (id) ON DELETE RESTRICT,
  actor_role TEXT NOT NULL
    CHECK (actor_role IN ('system', 'content_lead', 'moderator', 'reviewer', 'contributor')),
  CONSTRAINT item_state_transitions_human_actor_identified
    CHECK ((actor_role = 'system') OR (actor_user_id IS NOT NULL)),
  -- The route this transition established, where it established one.
  approval_route TEXT CHECK (approval_route IN ('auto_gated', 'human_reviewed', 'moderator_ruled')),
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX item_state_transitions_item_id_idx ON item_state_transitions (item_id, occurred_at);

-- Append-only for the same reason attempts and review_decisions are: an
-- audit trail that can be rewritten is not an audit trail.
CREATE FUNCTION forbid_item_state_transitions_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'item_state_transitions is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER item_state_transitions_forbid_update
BEFORE UPDATE ON item_state_transitions
FOR EACH ROW EXECUTE FUNCTION forbid_item_state_transitions_mutation();

CREATE TRIGGER item_state_transitions_forbid_delete
BEFORE DELETE ON item_state_transitions
FOR EACH ROW EXECUTE FUNCTION forbid_item_state_transitions_mutation();
