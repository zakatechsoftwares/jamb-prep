import { ILLUSTRATION_TICKET_STATUSES, type IllustrationTicketStatus } from './illustration-lifecycle';

/** An illustration ticket may only be claimed while it's still open. */
export function isIllustrationTicketClaimable(status: IllustrationTicketStatus): boolean {
  if (!(ILLUSTRATION_TICKET_STATUSES as readonly string[]).includes(status)) {
    throw new Error(`isIllustrationTicketClaimable: unrecognized status '${status}'`);
  }
  return status === 'open';
}
