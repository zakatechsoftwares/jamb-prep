CREATE TABLE passages (
  id BIGSERIAL PRIMARY KEY,
  title TEXT,
  body_text TEXT NOT NULL,
  source_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER passages_set_updated_at
BEFORE UPDATE ON passages
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
