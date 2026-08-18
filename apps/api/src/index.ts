import {
  authenticateReviewer,
  claimBrief,
  claimTicket,
  completeTicket,
  createBrief,
  decideOnItem,
  endSession,
  findOrCreateCandidate,
  getAuditSample,
  getContentLeadDashboard,
  getCoverageGaps,
  getNextItem,
  getNextItemBatch,
  listAvailableSubjectPacks,
  listOpenBriefs,
  listOpenTickets,
  listSubjectCombinations,
  loadActiveExamConfigId,
  loadSessionForResume,
  loadSketchPhoto,
  loadSubjectPack,
  recordAttempt,
  recordModeratorAudit,
  resolveEscalation,
  revealItem,
  runWeeklyPayment,
  scoreSession,
  setCandidateSubjectCombination,
  startSession,
  submitBlindAnswer,
  submitContributedItem,
  type Brief,
  type IllustrationTicket,
} from '@jamb/db';
import type {
  BriefSummary,
  CandidateSessionResumeResult,
  IllustrationTicketSummary,
} from '@jamb/shared';
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

function toIllustrationTicketSummary(ticket: IllustrationTicket): IllustrationTicketSummary {
  return {
    id: ticket.id,
    itemId: ticket.itemId,
    figureDescription: ticket.figureDescription,
    status: ticket.status,
    claimedByUserId: ticket.claimedByUserId,
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
    submitContributedItemWithDiagram: (briefId, contributorReviewerId, draft, sketchPhoto) =>
      submitContributedItem(briefId, contributorReviewerId, draft, new Date(), {
        bytes: Buffer.from(sketchPhoto.bytes),
        contentType: sketchPhoto.contentType,
      }).then((itemId) => ({ itemId })),
  },
  illustrationBoard: {
    listOpenTickets: () => listOpenTickets().then((tickets) => tickets.map(toIllustrationTicketSummary)),
    claimTicket: (ticketId, illustratorReviewerId) =>
      claimTicket(ticketId, illustratorReviewerId).then(toIllustrationTicketSummary),
    completeTicket: (ticketId, illustratorReviewerId, input) =>
      completeTicket(ticketId, illustratorReviewerId, input.svgMarkup, input.altText, new Date()).then(
        () => ({ ok: true as const }),
      ),
    loadSketchPhoto: (ticketId) => loadSketchPhoto(ticketId),
  },
  candidateSync: {
    register: (input) => findOrCreateCandidate(input),
    startSession: (candidateUserId, input) =>
      startSession({
        userId: candidateUserId,
        examConfigId: input.examConfigId,
        mode: input.mode,
        deviceId: input.deviceId,
        clientSessionId: input.clientSessionId,
        startedAt: new Date(input.startedAt),
      }).then((sessionId) => ({ sessionId })),
    recordAttempt: (candidateUserId, sessionId, input) =>
      recordAttempt({
        sessionId,
        itemId: input.itemId,
        userId: candidateUserId,
        chosenOption: input.chosenOption,
        secondsTaken: input.secondsTaken,
        flagged: input.flagged,
        answeredAt: new Date(input.answeredAt),
        idempotencyKey: input.idempotencyKey,
      }).then((attemptId) => ({ attemptId })),
    endSession: (_candidateUserId, sessionId, input) =>
      endSession(sessionId, new Date(input.endedAt)).then(({ mode }) =>
        mode === 'mock' ? scoreSession(sessionId) : null,
      ),
    // `loadSessionForResume` is keyed on clientSessionId alone, with no
    // notion of "whose session" -- this ownership check is what stops one
    // candidate's token from reading another's session by guessing or
    // reusing a clientSessionId, since the repository layer has nothing to
    // check that against.
    resumeSession: (candidateUserId, clientSessionId) =>
      loadSessionForResume(clientSessionId).then((resumed) => {
        if (!resumed || resumed.userId !== candidateUserId) {
          return null;
        }
        const result: CandidateSessionResumeResult = {
          sessionId: resumed.sessionId,
          startedAt: resumed.startedAt.toISOString(),
          endedAt: resumed.endedAt ? resumed.endedAt.toISOString() : null,
          examConfigId: resumed.examConfigId,
          attempts: resumed.attempts.map((attempt) => ({
            itemId: attempt.itemId,
            subjectId: attempt.subjectId,
            chosenOption: attempt.chosenOption,
            isCorrect: attempt.isCorrect,
            secondsTaken: attempt.secondsTaken,
            flagged: attempt.flagged,
            answeredAt: attempt.answeredAt.toISOString(),
            sequence: attempt.sequence,
          })),
        };
        return result;
      }),
  },
  contentPack: {
    listAvailablePacks: () =>
      Promise.all([loadActiveExamConfigId(), listAvailableSubjectPacks()]).then(
        ([activeExamConfigId, packs]) => ({ activeExamConfigId, packs }),
      ),
    downloadPack: (subjectId) => loadSubjectPack(subjectId),
  },
  subjectCombination: {
    listSubjectCombinations: () => listSubjectCombinations(),
    selectSubjectCombination: (candidateUserId, input) =>
      setCandidateSubjectCombination(candidateUserId, input.subjectCombinationId),
  },
});

app.listen(port, () => {
  console.log(`api listening on port ${port}`);
});
