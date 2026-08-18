import type { Pool, PoolClient } from 'pg';
import { isIllustrationTicketClaimable, type IllustrationTicketStatus, type ItemFacts } from '@jamb/shared';
import { pool } from './client';
import { firstRow } from './first-row';
import { promoteGeneratedItem } from './item-generation-repository';
import { loadReviewer, withTransaction } from './review-queue-repository';

/**
 * The diagram-request / illustration-ticket / illustrator queue sub-flow
 * (plan 7.12 steps 4-5). A ticket is created per item, not per brief — see
 * illustration-lifecycle.ts's doc comment for why this can't be known
 * earlier. Illustrators are not a new role: `claimTicket`/`completeTicket`
 * accept any active reviewer-pool account, matching the brief board's own
 * "one pool, no role wall" decision.
 */

export interface IllustrationTicket {
  id: number;
  itemId: number;
  requestedByUserId: number;
  figureDescription: string;
  status: IllustrationTicketStatus;
  claimedByUserId: number | null;
  claimedAt: Date | null;
  svgAsset: string | null;
  altText: string | null;
  completedAt: Date | null;
}

interface IllustrationTicketRow {
  id: number;
  item_id: number;
  requested_by: number;
  figure_description: string;
  status: IllustrationTicketStatus;
  claimed_by: number | null;
  claimed_at: Date | null;
  svg_asset: string | null;
  alt_text: string | null;
  completed_at: Date | null;
}

function toTicket(row: IllustrationTicketRow): IllustrationTicket {
  return {
    id: row.id,
    itemId: row.item_id,
    requestedByUserId: row.requested_by,
    figureDescription: row.figure_description,
    status: row.status,
    claimedByUserId: row.claimed_by,
    claimedAt: row.claimed_at,
    svgAsset: row.svg_asset,
    altText: row.alt_text,
    completedAt: row.completed_at,
  };
}

/**
 * Creates the ticket for an item that needs a figure. Called from inside
 * `submitContributedItem`'s own transaction (`brief-repository.ts`) in
 * place of the immediate `promoteGeneratedItem` call a non-diagram item
 * gets — the item stays in `generated` status until `completeTicket` fires
 * the same promotion later.
 */
export async function requestDiagram(
  client: PoolClient,
  itemId: number,
  requestedByUserId: number,
  figureDescription: string,
  sketchPhoto: Buffer,
  sketchPhotoContentType: string,
): Promise<number> {
  return firstRow(
    await client.query<{ id: number }>(
      `INSERT INTO illustration_tickets (
         item_id, requested_by, figure_description, sketch_photo, sketch_photo_content_type
       ) VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [itemId, requestedByUserId, figureDescription, sketchPhoto, sketchPhotoContentType],
    ),
  ).id;
}

export async function listOpenTickets(client?: PoolClient): Promise<IllustrationTicket[]> {
  const runner: Pool | PoolClient = client ?? pool;
  const result = await runner.query<IllustrationTicketRow>(
    `SELECT * FROM illustration_tickets WHERE status = 'open' ORDER BY created_at, id`,
  );
  return result.rows.map(toTicket);
}

export class IllustrationTicketNotFoundError extends Error {
  constructor(public readonly ticketId: number) {
    super(`illustration ticket ${ticketId} not found`);
    this.name = 'IllustrationTicketNotFoundError';
  }
}

export class IllustrationTicketNotClaimableError extends Error {
  constructor(
    public readonly ticketId: number,
    public readonly status: IllustrationTicketStatus,
  ) {
    super(`illustration ticket ${ticketId} is not claimable (status: ${status})`);
    this.name = 'IllustrationTicketNotClaimableError';
  }
}

export class IllustrationTicketNotClaimedByIllustratorError extends Error {
  constructor(
    public readonly ticketId: number,
    public readonly illustratorReviewerId: number,
  ) {
    super(`illustration ticket ${ticketId} is not claimed by reviewer ${illustratorReviewerId}`);
    this.name = 'IllustrationTicketNotClaimedByIllustratorError';
  }
}

/**
 * Claims one open ticket for an illustrator. Same `FOR UPDATE SKIP LOCKED`
 * concurrency pattern as `claimBrief` — the row lock makes two simultaneous
 * claimants disjoint, and `SKIP LOCKED` means the loser sees "not found"
 * rather than blocking.
 */
export async function claimTicket(ticketId: number, illustratorReviewerId: number): Promise<IllustrationTicket> {
  return withTransaction(async (client) => {
    const reviewer = await loadReviewer(client, illustratorReviewerId);

    const result = await client.query<IllustrationTicketRow>(
      `SELECT * FROM illustration_tickets WHERE id = $1 FOR UPDATE SKIP LOCKED`,
      [ticketId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new IllustrationTicketNotFoundError(ticketId);
    }
    if (!isIllustrationTicketClaimable(row.status)) {
      throw new IllustrationTicketNotClaimableError(ticketId, row.status);
    }

    const updated = firstRow(
      await client.query<IllustrationTicketRow>(
        `UPDATE illustration_tickets SET status = 'claimed', claimed_by = $2, claimed_at = now()
         WHERE id = $1 RETURNING *`,
        [ticketId, reviewer.user_id],
      ),
    );
    return toTicket(updated);
  });
}

/**
 * Completes a claimed ticket and promotes its item into the ordinary review
 * queue via the same `gates_passed` transition `submitContributedItem`
 * already uses for a non-diagram item — reused unmodified, just fired at a
 * later moment. The item's own risk_tier/independent_solve_verdict/
 * contributor_id are read back from the row rather than re-derived, since
 * they were already fixed at submission time.
 */
export async function completeTicket(
  ticketId: number,
  illustratorReviewerId: number,
  svgMarkup: string,
  altText: string,
  occurredAt: Date,
): Promise<void> {
  return withTransaction(async (client) => {
    const reviewer = await loadReviewer(client, illustratorReviewerId);

    const ticketResult = await client.query<IllustrationTicketRow>(
      `SELECT * FROM illustration_tickets WHERE id = $1 FOR UPDATE`,
      [ticketId],
    );
    const ticket = ticketResult.rows[0];
    if (!ticket) {
      throw new IllustrationTicketNotFoundError(ticketId);
    }
    if (ticket.claimed_by !== reviewer.user_id) {
      throw new IllustrationTicketNotClaimedByIllustratorError(ticketId, illustratorReviewerId);
    }

    await client.query(
      `UPDATE illustration_tickets
         SET status = 'completed', svg_asset = $2, alt_text = $3, completed_at = now()
       WHERE id = $1`,
      [ticketId, svgMarkup, altText],
    );

    const item = firstRow(
      await client.query<ItemFacts & { id: number }>(
        `SELECT id, contributor_id AS "contributorUserId", risk_tier AS "riskTier",
                independent_solve_verdict AS "independentSolveVerdict",
                sampled_for_review AS "sampledForReview"
           FROM items WHERE id = $1`,
        [ticket.item_id],
      ),
    );

    await promoteGeneratedItem(client, item.id, item, { type: 'gates_passed' }, occurredAt);
  });
}

export async function loadSketchPhoto(
  ticketId: number,
): Promise<{ bytes: Buffer; contentType: string } | null> {
  const result = await pool.query<{ sketch_photo: Buffer; sketch_photo_content_type: string }>(
    `SELECT sketch_photo, sketch_photo_content_type FROM illustration_tickets WHERE id = $1`,
    [ticketId],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return { bytes: row.sketch_photo, contentType: row.sketch_photo_content_type };
}
