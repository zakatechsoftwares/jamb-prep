CREATE TABLE institutions (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('school', 'tutorial_centre')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER institutions_set_updated_at
BEFORE UPDATE ON institutions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE cohorts (
  id BIGSERIAL PRIMARY KEY,
  institution_id BIGINT NOT NULL REFERENCES institutions (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (institution_id, name)
);

CREATE TRIGGER cohorts_set_updated_at
BEFORE UPDATE ON cohorts
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Single source of truth for cohort membership; no duplicated cohort
-- reference is kept on `users`.
CREATE TABLE cohort_assignments (
  id BIGSERIAL PRIMARY KEY,
  cohort_id BIGINT NOT NULL REFERENCES cohorts (id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'candidate' CHECK (role IN ('candidate', 'tutor')),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cohort_id, user_id)
);

CREATE TRIGGER cohort_assignments_set_updated_at
BEFORE UPDATE ON cohort_assignments
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
