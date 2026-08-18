-- The diagram-request / illustration-ticket / illustrator queue sub-flow
-- (plan 7.12 steps 4-5), deferred from 0021's contributor brief board.
--
-- Whether a specific item needs a figure is discovered by the contributor
-- while authoring that item, not knowable in advance from the objective or
-- the brief -- so a ticket is created per item, not per brief. Illustrators
-- are not a new role: any active reviewer-pool account may browse and claim
-- an open ticket, matching how contributors and reviewers already share one
-- pool with no role wall.

CREATE TABLE illustration_tickets (
  id BIGSERIAL PRIMARY KEY,
  -- One ticket per item -- "the illustrator produces THE asset" (singular).
  item_id BIGINT NOT NULL UNIQUE REFERENCES items (id) ON DELETE RESTRICT,
  requested_by BIGINT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  figure_description TEXT NOT NULL,
  -- A phone photo of a contributor's hand sketch -- a reference for the
  -- illustrator, never shown to a candidate. Low realistic volume, so a
  -- bytea column rather than a new object-storage dependency.
  sketch_photo BYTEA NOT NULL,
  sketch_photo_content_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'claimed', 'completed')),
  claimed_by BIGINT REFERENCES users (id) ON DELETE RESTRICT,
  claimed_at TIMESTAMPTZ,
  -- The final asset: scalable vector, plain text/XML -- not binary at all --
  -- so a TEXT column, no bytea needed here.
  svg_asset TEXT,
  alt_text TEXT,
  completed_at TIMESTAMPTZ,
  CONSTRAINT illustration_tickets_claim_consistency CHECK ((claimed_by IS NULL) = (claimed_at IS NULL)),
  CONSTRAINT illustration_tickets_completion_consistency
    CHECK (num_nulls(svg_asset, alt_text, completed_at) IN (0, 3)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX illustration_tickets_status_idx ON illustration_tickets (status);

CREATE TRIGGER illustration_tickets_set_updated_at
BEFORE UPDATE ON illustration_tickets
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
