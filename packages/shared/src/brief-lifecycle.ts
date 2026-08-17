/**
 * The contributor brief's lifecycle vocabulary (plan 7.12), declared once
 * here and nowhere else — mirrors item-lifecycle.ts's own rule. The
 * migration holds the same values in a CHECK constraint, and
 * brief-lifecycle-vocabulary.test.ts (packages/db) fails the build if the
 * two ever drift apart.
 */
export const BRIEF_STATUSES = ['open', 'claimed', 'completed'] as const;
export type BriefStatus = (typeof BRIEF_STATUSES)[number];
