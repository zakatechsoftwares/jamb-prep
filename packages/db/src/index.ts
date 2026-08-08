// Public surface of @jamb/db. Importing this opens the connection pool, so
// anything that must run without a database (createApp in a test, for
// instance) should depend on types from @jamb/shared instead.
export { pool } from './client';
export { firstRow } from './first-row';
export { deriveRiskTier } from './risk-tier';
export {
  QUEUE_PRIORITY_SQL,
  flagForJudgement,
  getNextItem,
  getNextItemBatch,
  goldStockoutsSince,
  loadActiveQueueConfig,
  releaseExpiredClaims,
  type GetNextItemOptions,
  type GoldStockoutCount,
} from './review-queue-repository';
// Only the functions are exported here — DecideInput, DecideOutcome and the
// rest of the decision service's shapes live in @jamb/shared (they are the
// contract apps/api is wired against), the same split ReviewQueueItem and
// ReviewQueueService already established for the queue.
export { decideOnItem, revealItem, submitBlindAnswer } from './review-decision-repository';
