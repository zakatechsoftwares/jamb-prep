import {
  authenticateReviewer,
  decideOnItem,
  getNextItem,
  getNextItemBatch,
  resolveEscalation,
  revealItem,
  submitBlindAnswer,
} from '@jamb/db';
import { createApp } from './app';

const port = process.env.PORT ?? 3000;

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
});

app.listen(port, () => {
  console.log(`api listening on port ${port}`);
});
