import type { RejectionReason } from './item-lifecycle';
import type { SubjectAgreement } from './inter-rater-agreement';

/**
 * The content lead dashboard's shapes (plan 7.11) and the service contract
 * `apps/api`'s content-lead routes need from it — declared here, the same
 * way `ReviewQueueService`/`ReviewDecisionService` are, so the API layer
 * can be wired against it without importing the database at module load.
 */

export interface RejectionReasonCount {
  subjectId: number;
  week: Date;
  rejectionReason: RejectionReason;
  count: number;
}

export interface SubjectQueueDepth {
  subjectId: number;
  depth: number;
}

export interface ItemStateCount {
  status: string;
  count: number;
}

export interface CostPerApprovedItem {
  approvedCount: number;
  /** USD. Never summed with avgReviewerFeesKobo — different currencies. */
  avgInferenceCostUsd: number;
  /** Kobo. See avgInferenceCostUsd's own note. */
  avgReviewerFeesKobo: number;
}

export interface ContentDashboard {
  acceptedItemsPerReviewerHour: number;
  rejectionReasons: RejectionReasonCount[];
  queueDepth: SubjectQueueDepth[];
  itemsByState: ItemStateCount[];
  costPerApprovedItem: CostPerApprovedItem;
  /** A content signal, not a reviewer signal — see inter-rater-agreement.ts. */
  interRaterAgreement: SubjectAgreement[];
}

export interface PaymentRunResult {
  batchId: number | null;
  totalKobo: number;
  lineCount: number;
}

export interface AuditSampleItem {
  itemId: number;
  reviewerId: number;
  decidedAt: Date;
}

export interface ContentLeadService {
  getDashboard(since: Date): Promise<ContentDashboard>;
  runWeeklyPayment(runAt: Date): Promise<PaymentRunResult>;
  getAuditSample(reviewerId: number, since: Date, count: number): Promise<AuditSampleItem[]>;
  recordModeratorAudit(
    itemId: number,
    moderatorId: number,
    agreed: boolean,
    note: string | null,
  ): Promise<void>;
}
