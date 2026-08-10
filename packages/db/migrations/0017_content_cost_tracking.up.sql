-- The content lead dashboard's "cost per approved item, split into
-- inference cost and reviewer fees" (7.11 / session 09) needs a real,
-- typed inference cost per item — items.provenance is unstructured JSONB
-- with no fixed schema, and parsing a cost out of it for an aggregate SUM
-- query is exactly the kind of fragility a dedicated column avoids.
--
-- Nullable: a human-authored/contributed item has no inference cost at
-- all, and the generation pipeline that would populate this for a
-- generated item does not exist yet (canonical session 10) — this column
-- is seeded directly for now.
ALTER TABLE items ADD COLUMN inference_cost_usd NUMERIC(10, 4)
  CHECK (inference_cost_usd IS NULL OR inference_cost_usd >= 0);
