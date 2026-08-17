import {
  authenticateReviewer,
  claimBrief,
  createBrief,
  decideOnItem,
  getAuditSample,
  getContentLeadDashboard,
  getCoverageGaps,
  getNextItem,
  getNextItemBatch,
  listOpenBriefs,
  recordModeratorAudit,
  resolveEscalation,
  revealItem,
  runWeeklyPayment,
  submitBlindAnswer,
  submitContributedItem,
  type Brief,
} from '@jamb/db';
import type { BriefSummary } from '@jamb/shared';
import { createApp } from './app';

const port = process.env.PORT ?? 3000;

/** packages/db's internal shape (Date objects) to the wire shape (ISO strings) — apps/api is where this conversion belongs, not the route or the repository. */
function toBriefSummary(brief: Brief): BriefSummary {
  return {
    id: brief.id,
    objectiveId: brief.objectiveId,
    itemCount: brief.itemCount,
    difficultySpread: brief.difficultySpread,
    cognitiveLevels: brief.cognitiveLevels,
    styleNotes: brief.styleNotes,
    feeKobo: brief.feeKobo,
    deadline: brief.deadline.toISOString(),
    status: brief.status,
    claimedByUserId: brief.claimedByUserId,
  };
}

// Wired here rather than inside createApp so that importing the app in a
// test never opens a database connection.
const app = createApp({
  auth: {
    login: (emailOrPhone, password) => authenticateReviewer(emailOrPhone, password),
  },
  reviewQueue: {
    getNextItem: (reviewerId) => getNextItem(reviewerId),
    getNextItemBatch: (reviewerId, count) => getNextItemBatch(reviewerId, count),
  },
  reviewDecision: {
    submitBlindAnswer: (reviewerId, itemId, answer) =>
      submitBlindAnswer(reviewerId, itemId, answer),
    revealItem: (reviewerId, itemId) => revealItem(reviewerId, itemId),
    decideOnItem: (reviewerId, itemId, input) => decideOnItem(reviewerId, itemId, input),
  },
  reviewEscalation: {
    resolveEscalation: (reviewerId, itemId, input) => resolveEscalation(reviewerId, itemId, input),
  },
  contentLead: {
    getDashboard: (since) => getContentLeadDashboard(since),
    runWeeklyPayment: (runAt) => runWeeklyPayment(runAt),
    getAuditSample: (reviewerId, since, count) => getAuditSample(reviewerId, since, count),
    recordModeratorAudit: (itemId, moderatorId, agreed, note) =>
      recordModeratorAudit(itemId, moderatorId, agreed, note),
    getGaps: () => getCoverageGaps(),
    createBrief: (input, createdByReviewerId) =>
      createBrief({ ...input, deadline: new Date(input.deadline) }, createdByReviewerId).then(
        (briefId) => ({ briefId }),
      ),
  },
  briefBoard: {
    listOpenBriefs: () => listOpenBriefs().then((briefs) => briefs.map(toBriefSummary)),
    claimBrief: (briefId, contributorReviewerId) =>
      claimBrief(briefId, contributorReviewerId).then(toBriefSummary),
    submitContributedItem: (briefId, contributorReviewerId, draft) =>
      submitContributedItem(briefId, contributorReviewerId, draft, new Date()).then((itemId) => ({
        itemId,
      })),
  },
});

app.listen(port, () => {
  console.log(`api listening on port ${port}`);
});
