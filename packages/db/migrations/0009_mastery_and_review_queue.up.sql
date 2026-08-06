CREATE TABLE mastery_estimates (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  objective_id BIGINT NOT NULL REFERENCES objectives (id) ON DELETE RESTRICT,
  estimated_ability NUMERIC(6, 4) NOT NULL,
  confidence NUMERIC(4, 3) NOT NULL,
  last_updated TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, objective_id)
);

CREATE TRIGGER mastery_estimates_set_updated_at
BEFORE UPDATE ON mastery_estimates
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE review_queue_entries (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  item_id BIGINT NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  due_at TIMESTAMPTZ NOT NULL,
  interval_days NUMERIC(8, 3) NOT NULL DEFAULT 0,
  stability NUMERIC(8, 3),
  last_reviewed_at TIMESTAMPTZ,
  state TEXT NOT NULL DEFAULT 'new' CHECK (state IN ('new', 'learning', 'review', 'relearning')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, item_id)
);

CREATE INDEX review_queue_entries_due_idx ON review_queue_entries (user_id, due_at);

CREATE TRIGGER review_queue_entries_set_updated_at
BEFORE UPDATE ON review_queue_entries
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
