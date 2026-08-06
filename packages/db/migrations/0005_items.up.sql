CREATE TABLE items (
  id BIGSERIAL PRIMARY KEY,

  subject_id BIGINT NOT NULL REFERENCES subjects (id) ON DELETE RESTRICT,
  topic_id BIGINT NOT NULL REFERENCES topics (id) ON DELETE RESTRICT,
  subtopic_id BIGINT NOT NULL REFERENCES subtopics (id) ON DELETE RESTRICT,
  objective_id BIGINT NOT NULL REFERENCES objectives (id) ON DELETE RESTRICT,
  passage_id BIGINT REFERENCES passages (id) ON DELETE RESTRICT,

  stem TEXT NOT NULL,
  explanation TEXT NOT NULL,
  method_steps TEXT[] NOT NULL DEFAULT '{}',

  cognitive_level TEXT NOT NULL
    CHECK (cognitive_level IN ('recall', 'comprehension', 'application', 'analysis')),

  author_difficulty NUMERIC(4, 3),
  calibrated_difficulty NUMERIC(4, 3),
  discrimination NUMERIC(4, 3),
  expected_time_seconds INTEGER NOT NULL,

  -- model/prompt version, generation timestamp, raw-response reference: an audit
  -- blob, not syllabus data, so JSONB is fine here (unlike the hierarchy above).
  provenance JSONB NOT NULL DEFAULT '{}'::jsonb,

  independent_solve_verdict TEXT CHECK (independent_solve_verdict IN ('agreed', 'disagreed')),
  risk_tier TEXT NOT NULL CHECK (risk_tier IN ('low', 'high')),

  status TEXT NOT NULL DEFAULT 'generated' CHECK (status IN (
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
  approval_route TEXT CHECK (approval_route IN ('auto_gated', 'human_reviewed', 'moderator_ruled')),
  version INTEGER NOT NULL DEFAULT 1,
  reviewer_id BIGINT REFERENCES users (id) ON DELETE RESTRICT,
  reviewed_at TIMESTAMPTZ,
  error_reports_count INTEGER NOT NULL DEFAULT 0,

  -- Stable external key (e.g. the generation batch's item id) so imports and
  -- the seed script can upsert idempotently instead of duplicating rows.
  external_ref TEXT UNIQUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX items_status_idx ON items (status);
CREATE INDEX items_risk_tier_idx ON items (risk_tier);
CREATE INDEX items_subject_id_idx ON items (subject_id);
CREATE INDEX items_objective_id_idx ON items (objective_id);

CREATE TRIGGER items_set_updated_at
BEFORE UPDATE ON items
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE item_options (
  id BIGSERIAL PRIMARY KEY,
  item_id BIGINT NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  label TEXT NOT NULL CHECK (label IN ('A', 'B', 'C', 'D')),
  option_text TEXT NOT NULL,
  is_correct BOOLEAN NOT NULL DEFAULT false,
  -- The specific named error this option represents (required at generation,
  -- checked at review per plan 7.6) — nullable at the DB level because not
  -- every import (e.g. the seed set) carries it yet; enforced by the review
  -- workflow, not a blanket CHECK that would reject legitimate seed data.
  distractor_rationale TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (item_id, label)
);

-- At most one correct option per item.
CREATE UNIQUE INDEX item_options_one_correct_idx ON item_options (item_id) WHERE is_correct;

CREATE TRIGGER item_options_set_updated_at
BEFORE UPDATE ON item_options
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
