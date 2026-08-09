import type { AuditSampleItem, ContentDashboard, PaymentRunResult } from '@jamb/shared';
import { pool } from './client';
import { withTransaction } from './review-queue-repository';
import {
  acceptedItemsPerReviewerHour,
  costPerApprovedItem,
  itemsByState,
  queueDepthBySubject,
  rejectionReasonsBySubjectAndWeek,
} from './content-dashboard-repository';
import { interRaterAgreementBySubject } from './inter-rater-agreement-repository';
import { generatePaymentRun } from './payment-run-repository';
import {
  generateModeratorAuditSample,
  recordModeratorAudit as insertModeratorAudit,
} from './moderator-audit-repository';

/**
 * The content-lead dashboard and its two write actions (plan 7.11), composed
 * from the per-concern repositories the same way `getNextItem`/`decideOnItem`
 * compose `review-queue-repository`'s pieces — each of those stays testable
 * against a single client, and this is the only place that opens a
 * connection for the whole picture.
 */
export async function getContentLeadDashboard(since: Date): Promise<ContentDashboard> {
  const client = await pool.connect();

  try {
    return {
      acceptedItemsPerReviewerHour: await acceptedItemsPerReviewerHour(client, since),
      rejectionReasons: await rejectionReasonsBySubjectAndWeek(client, since),
      queueDepth: await queueDepthBySubject(client),
      itemsByState: await itemsByState(client),
      costPerApprovedItem: await costPerApprovedItem(client),
      interRaterAgreement: await interRaterAgreementBySubject(client),
    };
  } finally {
    client.release();
  }
}

export async function runWeeklyPayment(runAt: Date): Promise<PaymentRunResult> {
  return withTransaction((client) => generatePaymentRun(client, runAt));
}

export async function getAuditSample(
  reviewerId: number,
  since: Date,
  count: number,
): Promise<AuditSampleItem[]> {
  const client = await pool.connect();

  try {
    return await generateModeratorAuditSample(client, reviewerId, since, count);
  } finally {
    client.release();
  }
}

export async function recordModeratorAudit(
  itemId: number,
  moderatorId: number,
  agreed: boolean,
  note: string | null,
): Promise<void> {
  const client = await pool.connect();

  try {
    await insertModeratorAudit(client, itemId, moderatorId, agreed, note);
  } finally {
    client.release();
  }
}
