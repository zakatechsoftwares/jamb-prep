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
