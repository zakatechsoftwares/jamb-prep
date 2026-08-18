import { Router } from 'express';
import multer from 'multer';
import type { BriefBoardService, ContributedItemInput } from '@jamb/shared';
import { parsePositiveInteger, resolveReviewerId } from '../reviewer-identity';

// Memory storage, not disk: the sketch photo goes straight into a Postgres
// bytea column (packages/db/src/illustration-repository.ts), never touches
// the filesystem. A generous but bounded limit -- a phone photo of a hand
// sketch, not a print-resolution scan.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

/**
 * The open brief board (plan 7.12, canonical session 11). No role gate
 * beyond an active session — matching how `isEligibleForReviewer` already
 * treats reviewers and contributors as one pool with no role-based wall.
 * Any active reviewer-pool account may browse, claim and submit against a
 * brief, same as the reviewer workspace's own `/next` route.
 */
export function createBriefsRouter(service: BriefBoardService): Router {
  const router = Router();

  router.get('/', (req, res, next) => {
    const reviewerId = resolveReviewerId(req);
    if (reviewerId === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }

    service.listOpenBriefs().then((briefs) => res.json({ briefs })).catch(next);
  });

  router.post('/:id/claim', (req, res, next) => {
    const reviewerId = resolveReviewerId(req);
    if (reviewerId === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }

    const briefId = parsePositiveInteger(req.params.id);
    if (briefId === null) {
      res.status(400).json({ error: 'brief id must be a positive integer' });
      return;
    }

    service.claimBrief(briefId, reviewerId).then((brief) => res.json(brief)).catch(next);
  });

  router.post('/:id/submit', (req, res, next) => {
    const reviewerId = resolveReviewerId(req);
    if (reviewerId === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }

    const briefId = parsePositiveInteger(req.params.id);
    if (briefId === null) {
      res.status(400).json({ error: 'brief id must be a positive integer' });
      return;
    }

    const parsed = parseContributedItemInput(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    if (parsed.input.diagramRequest !== null) {
      res.status(400).json({ error: 'an item needing a diagram must be submitted to /submit-with-diagram' });
      return;
    }

    service
      .submitContributedItem(briefId, reviewerId, parsed.input)
      .then((result) => res.status(201).json(result))
      .catch(next);
  });

  router.post('/:id/submit-with-diagram', upload.single('sketchPhoto'), (req, res, next) => {
    const reviewerId = resolveReviewerId(req);
    if (reviewerId === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }

    const briefId = parsePositiveInteger(req.params.id);
    if (briefId === null) {
      res.status(400).json({ error: 'brief id must be a positive integer' });
      return;
    }

    const body = req.body as Record<string, unknown> | undefined;
    if (typeof body?.itemJson !== 'string') {
      res.status(400).json({ error: 'itemJson must be present' });
      return;
    }
    let rawItem: unknown;
    try {
      rawItem = JSON.parse(body.itemJson);
    } catch {
      res.status(400).json({ error: 'itemJson must be valid JSON' });
      return;
    }
    const parsed = parseContributedItemInput(rawItem);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    if (parsed.input.diagramRequest === null) {
      res.status(400).json({ error: 'diagramRequest must be set to submit to /submit-with-diagram' });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: 'sketchPhoto file is required' });
      return;
    }

    service
      .submitContributedItemWithDiagram(briefId, reviewerId, parsed.input, {
        bytes: req.file.buffer,
        contentType: req.file.mimetype,
      })
      .then((result) => res.status(201).json(result))
      .catch(next);
  });

  return router;
}

type ParseResult<T> = { ok: true; input: T } | { ok: false; error: string };

const OPTION_LABELS = ['A', 'B', 'C', 'D'] as const;

/** Manual body parsing, matching every other route in this app — no schema library. */
function parseContributedItemInput(body: unknown): ParseResult<ContributedItemInput> {
  const raw = body as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'request body must be an object' };
  }
  if (typeof raw.stem !== 'string' || raw.stem.trim() === '') {
    return { ok: false, error: 'stem must be a non-empty string' };
  }
  if (typeof raw.explanation !== 'string' || raw.explanation.trim() === '') {
    return { ok: false, error: 'explanation must be a non-empty string' };
  }
  if (!Array.isArray(raw.methodSteps) || !raw.methodSteps.every((step) => typeof step === 'string')) {
    return { ok: false, error: 'methodSteps must be an array of strings' };
  }
  if (typeof raw.cognitiveLevel !== 'string' || raw.cognitiveLevel.trim() === '') {
    return { ok: false, error: 'cognitiveLevel must be a non-empty string' };
  }
  if (typeof raw.authorDifficulty !== 'number' || raw.authorDifficulty < 0 || raw.authorDifficulty > 1) {
    return { ok: false, error: 'authorDifficulty must be a number in [0, 1]' };
  }
  if (!Number.isInteger(raw.expectedTimeSeconds) || (raw.expectedTimeSeconds as number) <= 0) {
    return { ok: false, error: 'expectedTimeSeconds must be a positive integer' };
  }
  if (!Array.isArray(raw.options) || raw.options.length !== 4) {
    return { ok: false, error: 'options must be an array of exactly 4 entries' };
  }

  const options: ContributedItemInput['options'] = [];
  for (const label of OPTION_LABELS) {
    const option = (raw.options as unknown[]).find(
      (candidate) => (candidate as Record<string, unknown>)?.label === label,
    ) as Record<string, unknown> | undefined;
    if (!option) {
      return { ok: false, error: `options must include exactly one entry for label ${label}` };
    }
    if (typeof option.text !== 'string' || option.text.trim() === '') {
      return { ok: false, error: `option ${label} must have non-empty text` };
    }
    if (typeof option.isCorrect !== 'boolean') {
      return { ok: false, error: `option ${label} must have a boolean isCorrect` };
    }
    const hasRationale =
      typeof option.distractorRationale === 'string' && option.distractorRationale.trim() !== '';
    if (option.isCorrect && option.distractorRationale !== null) {
      return { ok: false, error: `option ${label} is correct, so distractorRationale must be null` };
    }
    if (!option.isCorrect && !hasRationale) {
      return { ok: false, error: `option ${label} is a wrong option and must have a non-empty distractorRationale` };
    }
    options.push({
      label,
      text: option.text,
      isCorrect: option.isCorrect,
      distractorRationale: option.distractorRationale as string | null,
    });
  }
  if (options.filter((option) => option.isCorrect).length !== 1) {
    return { ok: false, error: 'exactly one option must have isCorrect true' };
  }

  let diagramRequest: ContributedItemInput['diagramRequest'] = null;
  if (raw.diagramRequest !== null && raw.diagramRequest !== undefined) {
    const rawDiagram = raw.diagramRequest as Record<string, unknown>;
    if (typeof rawDiagram.figureDescription !== 'string' || rawDiagram.figureDescription.trim() === '') {
      return { ok: false, error: 'diagramRequest.figureDescription must be a non-empty string' };
    }
    diagramRequest = { figureDescription: rawDiagram.figureDescription };
  }

  return {
    ok: true,
    input: {
      stem: raw.stem,
      explanation: raw.explanation,
      methodSteps: raw.methodSteps as string[],
      cognitiveLevel: raw.cognitiveLevel,
      authorDifficulty: raw.authorDifficulty,
      expectedTimeSeconds: raw.expectedTimeSeconds as number,
      options,
      diagramRequest,
    },
  };
}
