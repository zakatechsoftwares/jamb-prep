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
  withTransaction,
  type GetNextItemOptions,
  type GoldStockoutCount,
} from './review-queue-repository';
// Only the functions are exported here — DecideInput, DecideOutcome and the
// rest of the decision service's shapes live in @jamb/shared (they are the
// contract apps/api is wired against), the same split ReviewQueueItem and
// ReviewQueueService already established for the queue.
export {
  decideOnItem,
  resolveEscalation,
  revealItem,
  submitBlindAnswer,
} from './review-decision-repository';
export { authenticateReviewer, setReviewerPassword } from './reviewer-auth-repository';
// The content-lead dashboard and its two write actions (plan 7.11), composed
// from content-dashboard-repository / inter-rater-agreement-repository /
// payment-run-repository / moderator-audit-repository. Only the composed,
// pool-managed functions are exported here — the per-client pieces stay
// internal, the same split `withTransaction` already established.
export {
  getAuditSample,
  getContentLeadDashboard,
  recordModeratorAudit,
  runWeeklyPayment,
} from './content-lead-service';
// The item-generation pipeline's own database access (item-generation-spec.md,
// plan 7.4) — tools/item-gen is the only consumer of these today.
export {
  insertGeneratedItem,
  loadLiveBankEmbeddings,
  loadObjectiveContext,
  promoteGeneratedItem,
  type EmbeddingCandidate,
  type GeneratedItemInsert,
  type GeneratedOptionInsert,
  type ObjectiveContext,
} from './item-generation-repository';
// The contributor brief board (plan 7.12, canonical session 11, Phase 1).
export {
  claimBrief,
  createBrief,
  getCoverageGaps,
  listOpenBriefs,
  submitContributedItem,
  BriefNotClaimableError,
  BriefNotClaimedByContributorError,
  BriefNotFoundError,
  type Brief,
  type BriefInsert,
  type ContributedItemDraft,
} from './brief-repository';
// The diagram-request / illustration-ticket / illustrator queue sub-flow
// (plan 7.12 steps 4-5), a follow-up to session 11's text-only brief board.
export {
  claimTicket,
  completeTicket,
  listOpenTickets,
  loadSketchPhoto,
  requestDiagram,
  IllustrationTicketNotClaimableError,
  IllustrationTicketNotClaimedByIllustratorError,
  IllustrationTicketNotFoundError,
  type IllustrationTicket,
} from './illustration-repository';
// The candidate exam-session engine (plan 8.3/8.4, canonical session 12,
// Phase 1 — logic and persistence only; no mobile UI yet).
export { loadExamConfigForUser, type ResolvedExamConfig } from './exam-config-repository';
// Candidate identity for progress sync (plan 8.3, follow-up session).
export { findOrCreateCandidate, type CandidateRegistrationDraft } from './candidate-repository';
export {
  endSession,
  loadSessionForResume,
  recordAttempt,
  scoreSession,
  startSession,
  type RecordAttemptInput,
  type SessionAttemptRow,
  type SessionForResume,
  type StartSessionInput,
} from './session-repository';
