DROP TRIGGER IF EXISTS attempts_forbid_delete ON attempts;
DROP TRIGGER IF EXISTS attempts_forbid_update ON attempts;
DROP FUNCTION IF EXISTS forbid_attempts_mutation();
DROP TABLE IF EXISTS attempts;
