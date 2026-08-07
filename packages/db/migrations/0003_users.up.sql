CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  email TEXT UNIQUE,
  exam_year INTEGER NOT NULL,
  subject_combination_id BIGINT REFERENCES subject_combinations (id) ON DELETE RESTRICT,
  entitlement_status TEXT NOT NULL DEFAULT 'free'
    CHECK (entitlement_status IN ('free', 'active', 'expired', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER users_set_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
