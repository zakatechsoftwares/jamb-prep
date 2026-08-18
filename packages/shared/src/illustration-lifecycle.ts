/**
 * An illustration ticket's lifecycle vocabulary (plan 7.12 step 4-5),
 * declared once here and nowhere else — mirrors brief-lifecycle.ts's own
 * rule. The migration holds the same values in a CHECK constraint, and
 * illustration-lifecycle-vocabulary.test.ts (packages/db) fails the build
 * if the two ever drift apart.
 */
export const ILLUSTRATION_TICKET_STATUSES = ['open', 'claimed', 'completed'] as const;
export type IllustrationTicketStatus = (typeof ILLUSTRATION_TICKET_STATUSES)[number];
