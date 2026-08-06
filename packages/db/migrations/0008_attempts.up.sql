CREATE TABLE attempts (
  id BIGSERIAL PRIMARY KEY,
  session_id BIGINT NOT NULL REFERENCES sessions (id) ON DELETE RESTRICT,
  item_id BIGINT NOT NULL REFERENCES items (id) ON DELETE RESTRICT,
  user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  chosen_option TEXT CHECK (chosen_option IN ('A', 'B', 'C', 'D')),
  is_correct BOOLEAN,
  seconds_taken INTEGER NOT NULL,
  flagged BOOLEAN NOT NULL DEFAULT false,
  answered_at TIMESTAMPTZ NOT NULL,
  -- Idempotency key for offline-first sync: retries must never double-count
  -- an attempt.
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Present for schema consistency with every other table, but since the
  -- guard below blocks all UPDATEs, this is set once at insert and can
  -- never legitimately change.
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX attempts_session_id_idx ON attempts (session_id);
CREATE INDEX attempts_item_id_idx ON attempts (item_id);
CREATE INDEX attempts_user_id_idx ON attempts (user_id);

-- Attempts are append-only by architectural rule: never update or delete an
-- attempt row. Enforced at the DB level, not just in application code.
CREATE FUNCTION forbid_attempts_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'attempts is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER attempts_forbid_update
BEFORE UPDATE ON attempts
FOR EACH ROW EXECUTE FUNCTION forbid_attempts_mutation();

CREATE TRIGGER attempts_forbid_delete
BEFORE DELETE ON attempts
FOR EACH ROW EXECUTE FUNCTION forbid_attempts_mutation();
