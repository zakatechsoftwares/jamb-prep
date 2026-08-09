export const APP_NAME = 'JAMB UTME Prep';

export type HealthStatus = 'ok' | 'degraded' | 'down';

// The item lifecycle vocabulary and state machine. Re-exported here because
// these are consumed across packages (`@jamb/db` checks its migrations
// against them) and must exist in exactly one place.
export * from './item-lifecycle';
export * from './item-state-machine';
export * from './review-queue-policy';
export * from './review-decision-policy';
export * from './reviewer-auth-policy';
