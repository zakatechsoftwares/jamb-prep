-- Reviewer payment (plan 7.11): per-decision earnings, frozen at decision
-- time against whichever rate config was active then, and the weekly
-- payment run that pays them out.

-- 1. Rate configuration -------------------------------------------------

-- Versioned like review_queue_configs, for the same reason: rates are an
-- operating decision, not a release. Amounts are in kobo (NGN's smallest
-- unit), matching transactions.amount_kobo (migration 0011).
CREATE TABLE payment_rate_configs (
  id BIGSERIAL PRIMARY KEY,
  version INTEGER NOT NULL UNIQUE,

  base_rate_kobo BIGINT NOT NULL CHECK (base_rate_kobo >= 0),
  -- Additional pay for a risk_tier = 'high' (calculation) item.
  high_tier_bonus_kobo BIGINT NOT NULL CHECK (high_tier_bonus_kobo >= 0),
  -- Additional pay when a decision resolves needs_second_review. Stacks
  -- with the high-tier bonus — packages/shared/earnings-policy.ts is the
  -- single statement of this arithmetic; this table only supplies the
  -- amounts.
  second_review_bonus_kobo BIGINT NOT NULL CHECK (second_review_bonus_kobo >= 0),

  active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX payment_rate_configs_one_active_idx ON payment_rate_configs (active)
WHERE active;

CREATE TRIGGER payment_rate_configs_set_updated_at
BEFORE UPDATE ON payment_rate_configs
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO payment_rate_configs (
  version, base_rate_kobo, high_tier_bonus_kobo, second_review_bonus_kobo, active
) VALUES (1, 5000, 3000, 2000, true);

-- 2. Payment batches (the weekly run's output) ---------------------------

CREATE TABLE payment_batches (
  id BIGSERIAL PRIMARY KEY,
  run_at TIMESTAMPTZ NOT NULL,
  total_amount_kobo BIGINT NOT NULL CHECK (total_amount_kobo >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Insert-only, like review_decisions and item_state_transitions: a payment
-- batch is a historical fact about what was paid, not a row to revise.
CREATE FUNCTION forbid_payment_batches_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'payment_batches is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payment_batches_forbid_update
BEFORE UPDATE ON payment_batches
FOR EACH ROW EXECUTE FUNCTION forbid_payment_batches_mutation();

CREATE TRIGGER payment_batches_forbid_delete
BEFORE DELETE ON payment_batches
FOR EACH ROW EXECUTE FUNCTION forbid_payment_batches_mutation();

-- Per-reviewer statement lines within a batch — the bank-transfer file is
-- generated from these (one line per reviewer, one transfer), and each
-- reviewer's own statement view reads their own lines across batches.
CREATE TABLE payment_batch_lines (
  id BIGSERIAL PRIMARY KEY,
  payment_batch_id BIGINT NOT NULL REFERENCES payment_batches (id) ON DELETE RESTRICT,
  reviewer_id BIGINT NOT NULL REFERENCES reviewers (id) ON DELETE RESTRICT,
  amount_kobo BIGINT NOT NULL CHECK (amount_kobo >= 0),
  decision_count INTEGER NOT NULL CHECK (decision_count > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (payment_batch_id, reviewer_id)
);

CREATE INDEX payment_batch_lines_reviewer_idx ON payment_batch_lines (reviewer_id, created_at);

CREATE TRIGGER payment_batch_lines_forbid_update
BEFORE UPDATE ON payment_batch_lines
FOR EACH ROW EXECUTE FUNCTION forbid_payment_batches_mutation();

CREATE TRIGGER payment_batch_lines_forbid_delete
BEFORE DELETE ON payment_batch_lines
FOR EACH ROW EXECUTE FUNCTION forbid_payment_batches_mutation();

-- 3. Reviewer earnings — one row per decision ----------------------------

-- Earnings for both a 'live' and a 'late_arrival' decision (migration
-- 0016): a late-arriving second opinion is still real reviewer work, and
-- is paid the same as any other decision of its kind. Deliberately NOT
-- clawed back if the reviewer is later deactivated for sustained low
-- accuracy (7.11 / session 09) — the work was done at the time, and
-- removal from the panel is the remedy, not retroactive unpaid work. See
-- review-quality-repository.ts's deactivateForSustainedFailure.
CREATE TABLE reviewer_earnings (
  id BIGSERIAL PRIMARY KEY,
  review_decision_id BIGINT NOT NULL UNIQUE REFERENCES review_decisions (id) ON DELETE RESTRICT,
  reviewer_id BIGINT NOT NULL REFERENCES reviewers (id) ON DELETE RESTRICT,
  amount_kobo BIGINT NOT NULL CHECK (amount_kobo >= 0),
  -- What produced amount_kobo — the rate config version, risk_tier and
  -- second-review flag at decision time — so a later question ("why was
  -- this decision paid this much") never depends on reconstructing state
  -- that may since have changed (the item's risk_tier can't change, but
  -- the active rate config will, over time).
  rate_basis JSONB NOT NULL,
  paid_at TIMESTAMPTZ,
  payment_batch_id BIGINT REFERENCES payment_batches (id) ON DELETE RESTRICT,
  CONSTRAINT reviewer_earnings_paid_consistency
    CHECK ((paid_at IS NULL) = (payment_batch_id IS NULL)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX reviewer_earnings_reviewer_idx ON reviewer_earnings (reviewer_id, created_at);
-- The payment run's own query: "everything not yet paid".
CREATE INDEX reviewer_earnings_unpaid_idx ON reviewer_earnings (reviewer_id) WHERE paid_at IS NULL;

CREATE TRIGGER reviewer_earnings_set_updated_at
BEFORE UPDATE ON reviewer_earnings
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- amount_kobo and rate_basis are immutable once written — a money row
-- that can be silently rewritten is worse than none. paid_at and
-- payment_batch_id may each move from NULL to a value exactly once (the
-- payment run marking the row paid), never changed again afterwards.
CREATE FUNCTION forbid_reviewer_earnings_rewrite()
RETURNS trigger AS $$
BEGIN
  IF NEW.amount_kobo IS DISTINCT FROM OLD.amount_kobo THEN
    RAISE EXCEPTION 'reviewer_earnings.amount_kobo is immutable once recorded';
  END IF;
  IF NEW.rate_basis IS DISTINCT FROM OLD.rate_basis THEN
    RAISE EXCEPTION 'reviewer_earnings.rate_basis is immutable once recorded';
  END IF;
  IF OLD.paid_at IS NOT NULL AND NEW.paid_at IS DISTINCT FROM OLD.paid_at THEN
    RAISE EXCEPTION 'reviewer_earnings.paid_at may only be set once, from NULL';
  END IF;
  IF OLD.payment_batch_id IS NOT NULL AND NEW.payment_batch_id IS DISTINCT FROM OLD.payment_batch_id THEN
    RAISE EXCEPTION 'reviewer_earnings.payment_batch_id may only be set once, from NULL';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER reviewer_earnings_forbid_rewrite
BEFORE UPDATE ON reviewer_earnings
FOR EACH ROW EXECUTE FUNCTION forbid_reviewer_earnings_rewrite();
