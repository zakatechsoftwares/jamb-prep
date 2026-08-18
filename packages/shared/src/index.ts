export const APP_NAME = 'JAMB UTME Prep';

export type HealthStatus = 'ok' | 'degraded' | 'down';

// The item lifecycle vocabulary and state machine. Re-exported here because
// these are consumed across packages (`@jamb/db` checks its migrations
// against them) and must exist in exactly one place.
export * from './item-lifecycle';
export * from './item-state-machine';
export * from './scoring';
export * from './review-queue-policy';
export * from './review-decision-policy';
export * from './reviewer-auth-policy';
export * from './gold-scoring-policy';
export * from './earnings-policy';
export * from './accuracy-threshold-policy';
export * from './inter-rater-agreement';
export * from './content-lead-policy';
export * from './item-gen-gates';
export * from './item-gen-cost';
export * from './brief-lifecycle';
export * from './gap-detection-policy';
export * from './brief-policy';
export * from './brief-board-policy';
export * from './illustration-lifecycle';
export * from './illustration-ticket-policy';
export * from './exam-timer';
export * from './mock-session-reducer';
export * from './sync-ids';
export * from './candidate-sync-policy';
export * from './content-pack-policy';
