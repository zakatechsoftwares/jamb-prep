CREATE TABLE exam_configs (
  id BIGSERIAL PRIMARY KEY,
  exam_year INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  total_duration_minutes INTEGER NOT NULL,
  total_marks INTEGER NOT NULL,
  negative_marking BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (exam_year, version)
);

-- Only one exam_config may be the live blueprint at a time.
CREATE UNIQUE INDEX exam_configs_one_active_idx ON exam_configs (is_active) WHERE is_active;

CREATE TRIGGER exam_configs_set_updated_at
BEFORE UPDATE ON exam_configs
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE exam_config_subject_rules (
  id BIGSERIAL PRIMARY KEY,
  exam_config_id BIGINT NOT NULL REFERENCES exam_configs (id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('compulsory', 'elective')),
  -- Set for 'compulsory' (always Use of English); left null for 'elective',
  -- since which three subjects fill that role varies per subject_combination.
  subject_id BIGINT REFERENCES subjects (id) ON DELETE RESTRICT,
  slot_count INTEGER NOT NULL,
  items_per_subject INTEGER NOT NULL,
  marks_per_subject INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (exam_config_id, role)
);

CREATE TRIGGER exam_config_subject_rules_set_updated_at
BEFORE UPDATE ON exam_config_subject_rules
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
