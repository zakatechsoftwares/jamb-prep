CREATE TABLE sessions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  exam_config_id BIGINT NOT NULL REFERENCES exam_configs (id) ON DELETE RESTRICT,
  mode TEXT NOT NULL CHECK (mode IN ('practice', 'mock')),
  device_id TEXT NOT NULL,
  -- Idempotency key for offline-first sync: retries of the same local
  -- session creation must never double-count.
  client_session_id TEXT NOT NULL UNIQUE,
  sync_state TEXT NOT NULL DEFAULT 'local_only'
    CHECK (sync_state IN ('local_only', 'syncing', 'synced')),
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX sessions_user_id_idx ON sessions (user_id);

CREATE TRIGGER sessions_set_updated_at
BEFORE UPDATE ON sessions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
