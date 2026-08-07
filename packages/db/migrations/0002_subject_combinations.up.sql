CREATE TABLE subject_combinations (
  id BIGSERIAL PRIMARY KEY,
  course_name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER subject_combinations_set_updated_at
BEFORE UPDATE ON subject_combinations
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE subject_combination_subjects (
  id BIGSERIAL PRIMARY KEY,
  subject_combination_id BIGINT NOT NULL REFERENCES subject_combinations (id) ON DELETE CASCADE,
  subject_id BIGINT NOT NULL REFERENCES subjects (id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role IN ('compulsory', 'elective')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (subject_combination_id, subject_id)
);

CREATE TRIGGER subject_combination_subjects_set_updated_at
BEFORE UPDATE ON subject_combination_subjects
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
