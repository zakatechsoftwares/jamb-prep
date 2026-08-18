import { Router } from 'express';
import type {
  CandidateSyncService,
  EndCandidateSessionInput,
  RecordCandidateAttemptInput,
  RegisterCandidateInput,
  StartCandidateSessionInput,
} from '@jamb/shared';
import { signCandidateToken } from '@jamb/db/candidate-tokens';
import { candidateSessionSecret, resolveCandidateId } from '../candidate-identity';
import { parsePositiveInteger } from '../reviewer-identity';

const CANDIDATE_TOKEN_TTL_MINUTES = 60 * 24 * 30; // 30 days -- a candidate re-registers rarely

/**
 * Progress sync (plan 8.3, follow-up to canonical session 12): candidate
 * registration plus the upload/resume path for the session-repository.ts
 * functions session 12 already built and exported. `/register` is the one
 * route with no auth check — it's the auth entry point itself, and (like
 * `auth.ts`'s `/login`) it is the one place that signs a token, not
 * `apps/api/src/index.ts`'s service wiring. Every other route resolves the
 * actor from `resolveCandidateId(req)`, never a body-supplied id, matching
 * this repo's existing identity discipline.
 */
export function createCandidateRouter(service: CandidateSyncService): Router {
  const router = Router();

  router.post('/register', (req, res, next) => {
    const parsed = parseRegisterInput(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    service
      .register(parsed.input)
      .then(({ userId }) => {
        const token = signCandidateToken(
          { userId },
          candidateSessionSecret(),
          new Date(),
          CANDIDATE_TOKEN_TTL_MINUTES,
        );
        res.status(201).json({ token, userId });
      })
      .catch(next);
  });

  router.post('/sessions', (req, res, next) => {
    const candidateUserId = resolveCandidateId(req);
    if (candidateUserId === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }

    const parsed = parseStartSessionInput(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    service
      .startSession(candidateUserId, parsed.input)
      .then((result) => res.status(201).json(result))
      .catch(next);
  });

  router.post('/sessions/:sessionId/attempts', (req, res, next) => {
    const candidateUserId = resolveCandidateId(req);
    if (candidateUserId === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }

    const sessionId = parsePositiveInteger(req.params.sessionId);
    if (sessionId === null) {
      res.status(400).json({ error: 'session id must be a positive integer' });
      return;
    }

    const parsed = parseRecordAttemptInput(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    service
      .recordAttempt(candidateUserId, sessionId, parsed.input)
      .then((result) => res.status(201).json(result))
      .catch(next);
  });

  router.post('/sessions/:sessionId/end', (req, res, next) => {
    const candidateUserId = resolveCandidateId(req);
    if (candidateUserId === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }

    const sessionId = parsePositiveInteger(req.params.sessionId);
    if (sessionId === null) {
      res.status(400).json({ error: 'session id must be a positive integer' });
      return;
    }

    const parsed = parseEndSessionInput(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    service
      .endSession(candidateUserId, sessionId, parsed.input)
      .then((result) => res.json(result))
      .catch(next);
  });

  router.get('/sessions/:clientSessionId/resume', (req, res, next) => {
    const candidateUserId = resolveCandidateId(req);
    if (candidateUserId === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }

    service
      .resumeSession(candidateUserId, req.params.clientSessionId as string)
      .then((result) => {
        if (!result) {
          res.status(404).json({ error: 'session not found' });
          return;
        }
        res.json(result);
      })
      .catch(next);
  });

  return router;
}

type ParseResult<T> = { ok: true; input: T } | { ok: false; error: string };

function parseRegisterInput(body: unknown): ParseResult<RegisterCandidateInput> {
  const raw = body as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'request body must be an object' };
  }
  if (typeof raw.fullName !== 'string' || raw.fullName.trim() === '') {
    return { ok: false, error: 'fullName must be a non-empty string' };
  }
  if (typeof raw.phone !== 'string' || raw.phone.trim() === '') {
    return { ok: false, error: 'phone must be a non-empty string' };
  }
  if (!Number.isInteger(raw.examYear) || (raw.examYear as number) <= 0) {
    return { ok: false, error: 'examYear must be a positive integer' };
  }

  return {
    ok: true,
    input: { fullName: raw.fullName, phone: raw.phone, examYear: raw.examYear as number },
  };
}

function parseStartSessionInput(body: unknown): ParseResult<StartCandidateSessionInput> {
  const raw = body as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'request body must be an object' };
  }
  if (typeof raw.clientSessionId !== 'string' || raw.clientSessionId.trim() === '') {
    return { ok: false, error: 'clientSessionId must be a non-empty string' };
  }
  if (!Number.isInteger(raw.examConfigId) || (raw.examConfigId as number) <= 0) {
    return { ok: false, error: 'examConfigId must be a positive integer' };
  }
  if (raw.mode !== 'practice' && raw.mode !== 'mock') {
    return { ok: false, error: `mode must be 'practice' or 'mock'` };
  }
  if (typeof raw.deviceId !== 'string' || raw.deviceId.trim() === '') {
    return { ok: false, error: 'deviceId must be a non-empty string' };
  }
  if (typeof raw.startedAt !== 'string' || Number.isNaN(Date.parse(raw.startedAt))) {
    return { ok: false, error: 'startedAt must be a valid ISO date string' };
  }

  return {
    ok: true,
    input: {
      clientSessionId: raw.clientSessionId,
      examConfigId: raw.examConfigId as number,
      mode: raw.mode,
      deviceId: raw.deviceId,
      startedAt: raw.startedAt,
    },
  };
}

const OPTION_LABELS = ['A', 'B', 'C', 'D'];

function parseRecordAttemptInput(body: unknown): ParseResult<RecordCandidateAttemptInput> {
  const raw = body as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'request body must be an object' };
  }
  if (!Number.isInteger(raw.itemId) || (raw.itemId as number) <= 0) {
    return { ok: false, error: 'itemId must be a positive integer' };
  }
  if (typeof raw.chosenOption !== 'string' || !OPTION_LABELS.includes(raw.chosenOption)) {
    return { ok: false, error: `chosenOption must be one of ${OPTION_LABELS.join(', ')}` };
  }
  if (!Number.isInteger(raw.secondsTaken) || (raw.secondsTaken as number) < 0) {
    return { ok: false, error: 'secondsTaken must be a non-negative integer' };
  }
  if (typeof raw.flagged !== 'boolean') {
    return { ok: false, error: 'flagged must be a boolean' };
  }
  if (typeof raw.answeredAt !== 'string' || Number.isNaN(Date.parse(raw.answeredAt))) {
    return { ok: false, error: 'answeredAt must be a valid ISO date string' };
  }
  if (typeof raw.idempotencyKey !== 'string' || raw.idempotencyKey.trim() === '') {
    return { ok: false, error: 'idempotencyKey must be a non-empty string' };
  }

  return {
    ok: true,
    input: {
      itemId: raw.itemId as number,
      chosenOption: raw.chosenOption as RecordCandidateAttemptInput['chosenOption'],
      secondsTaken: raw.secondsTaken as number,
      flagged: raw.flagged,
      answeredAt: raw.answeredAt,
      idempotencyKey: raw.idempotencyKey,
    },
  };
}

function parseEndSessionInput(body: unknown): ParseResult<EndCandidateSessionInput> {
  const raw = body as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'request body must be an object' };
  }
  if (typeof raw.endedAt !== 'string' || Number.isNaN(Date.parse(raw.endedAt))) {
    return { ok: false, error: 'endedAt must be a valid ISO date string' };
  }

  return { ok: true, input: { endedAt: raw.endedAt } };
}
