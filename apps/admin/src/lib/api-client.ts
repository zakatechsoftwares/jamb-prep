import type {
  ApprovalRoute,
  ContentDashboard,
  DecisionContext,
  ItemEditPatch,
  ItemStatus,
  OptionLabel,
  PanelRole,
  RejectionReason,
  RejectionReasonCount,
  RevealResult,
  ReviewQueueItem,
} from '@jamb/shared';

/**
 * Typed wrappers around the five reviewer routes plus login (plan 7.9,
 * session 06b). `fetchImpl` is injected — never the global `fetch` — so
 * every function here is testable against a fake, network-free
 * implementation, the same discipline CLAUDE.md asks for the clock and
 * randomness.
 *
 * Every function reports `{ ok: false, reason: 'unauthorized' }` on a 401
 * from any of the five reviewer routes, uniformly — that is the one
 * signal `AuthProvider` needs to clear the token and redirect to login.
 * `login` itself never reports `unauthorized`: its own 401 means "wrong
 * credentials," a caller who is not authenticated at all yet, which is a
 * different fact from "your session stopped being valid."
 */
export type FetchImpl = typeof fetch;

type WireQueueItem = Omit<ReviewQueueItem, 'claimExpiresAt'> & { claimExpiresAt: string };

function toQueueItem(wire: WireQueueItem): ReviewQueueItem {
  return { ...wire, claimExpiresAt: new Date(wire.claimExpiresAt) };
}

type WireRejectionReasonCount = Omit<RejectionReasonCount, 'week'> & { week: string };
type WireContentDashboard = Omit<ContentDashboard, 'rejectionReasons'> & {
  rejectionReasons: WireRejectionReasonCount[];
};

function toContentDashboard(wire: WireContentDashboard): ContentDashboard {
  return {
    ...wire,
    rejectionReasons: wire.rejectionReasons.map((row) => ({ ...row, week: new Date(row.week) })),
  };
}

interface RawResponse {
  status: number;
  body: Record<string, unknown> | null;
}

const NETWORK_ERROR: RawResponse = { status: 0, body: null };

async function call(
  fetchImpl: FetchImpl,
  method: string,
  url: string,
  token: string | null,
  jsonBody?: unknown,
): Promise<RawResponse> {
  const headers: Record<string, string> = {};
  if (jsonBody !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (token !== null) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method,
      headers,
      body: jsonBody !== undefined ? JSON.stringify(jsonBody) : undefined,
    });
  } catch {
    return NETWORK_ERROR;
  }

  if (response.status === 204) {
    return { status: response.status, body: null };
  }

  let body: Record<string, unknown> | null;
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    body = null;
  }

  return { status: response.status, body };
}

function errorReason(response: RawResponse, fallback: string): string {
  const reason = response.body?.error;
  return typeof reason === 'string' ? reason : fallback;
}

export type LoginOutcome =
  | { ok: true; token: string; reviewerId: number; role: PanelRole }
  | { ok: false; reason: 'invalid_credentials' }
  | { ok: false; reason: 'request_failed'; message: string };

export type GetNextItemOutcome =
  | { ok: true; item: ReviewQueueItem | null }
  | { ok: false; reason: 'unauthorized' }
  | { ok: false; reason: 'request_failed'; message: string };

export type GetNextItemBatchOutcome =
  | { ok: true; items: ReviewQueueItem[] }
  | { ok: false; reason: 'unauthorized' }
  | { ok: false; reason: 'request_failed'; message: string };

export type SubmitSolveOutcome =
  | { ok: true; itemId: number; answer: OptionLabel }
  | { ok: false; reason: 'unauthorized' }
  | { ok: false; reason: 'not_claimed_by_you' | 'already_answered' }
  | { ok: false; reason: 'request_failed'; message: string };

export type RevealOutcome =
  | { ok: true; result: RevealResult }
  | { ok: false; reason: 'unauthorized' }
  | { ok: false; reason: 'not_claimed_by_you' | 'not_yet_solved' }
  | { ok: false; reason: 'request_failed'; message: string };

export type DecideRequestInput =
  | { action: 'approve' }
  | { action: 'escalate' }
  | { action: 'reject'; rejectionReason: RejectionReason }
  | { action: 'edit_and_approve'; edits: ItemEditPatch };

export type DecideOutcome =
  | {
      ok: true;
      itemId: number;
      status: ItemStatus;
      approvalRoute: ApprovalRoute | null;
      decisionContext: DecisionContext;
    }
  | { ok: false; reason: 'unauthorized' }
  | { ok: false; reason: 'not_claimed_by_you' }
  | { ok: false; reason: 'invalid_transition'; message: string }
  | { ok: false; reason: 'request_failed'; message: string };

export type GetContentDashboardOutcome =
  | { ok: true; dashboard: ContentDashboard }
  | { ok: false; reason: 'unauthorized' }
  | { ok: false; reason: 'forbidden' }
  | { ok: false; reason: 'request_failed'; message: string };

export interface ApiClient {
  login(emailOrPhone: string, password: string): Promise<LoginOutcome>;
  getNextItem(token: string): Promise<GetNextItemOutcome>;
  getNextItemBatch(token: string, count: number): Promise<GetNextItemBatchOutcome>;
  submitSolve(token: string, itemId: number, answer: OptionLabel): Promise<SubmitSolveOutcome>;
  reveal(token: string, itemId: number): Promise<RevealOutcome>;
  /**
   * `idempotencyKey` is what makes a queued offline decision safe to retry
   * (8.3) — omit it for an ordinary live decide, where each call is its own
   * new request and the server generates one that only that one request
   * can ever use.
   */
  decide(
    token: string,
    itemId: number,
    input: DecideRequestInput,
    idempotencyKey?: string,
  ): Promise<DecideOutcome>;
  /** The content-lead dashboard (plan 7.11) — a `content_lead` session only. */
  getContentDashboard(token: string, since: Date): Promise<GetContentDashboardOutcome>;
}

/** `baseUrl` defaults to the same-origin proxy path — see next.config.mjs's rewrite. */
export function createApiClient(fetchImpl: FetchImpl, baseUrl = '/api/review'): ApiClient {
  return {
    async login(emailOrPhone, password) {
      const response = await call(fetchImpl, 'POST', `${baseUrl}/login`, null, {
        emailOrPhone,
        password,
      });

      if (response.status === 0) {
        return { ok: false, reason: 'request_failed', message: 'could not reach the server' };
      }
      if (response.status === 200) {
        return {
          ok: true,
          token: response.body?.token as string,
          reviewerId: response.body?.reviewerId as number,
          role: response.body?.role as PanelRole,
        };
      }
      return { ok: false, reason: 'invalid_credentials' };
    },

    async getNextItem(token) {
      const response = await call(fetchImpl, 'GET', `${baseUrl}/next`, token);

      if (response.status === 0) {
        return { ok: false, reason: 'request_failed', message: 'could not reach the server' };
      }
      if (response.status === 401) {
        return { ok: false, reason: 'unauthorized' };
      }
      if (response.status === 204) {
        return { ok: true, item: null };
      }
      return { ok: true, item: toQueueItem(response.body as unknown as WireQueueItem) };
    },

    async getNextItemBatch(token, count) {
      const response = await call(fetchImpl, 'GET', `${baseUrl}/next-batch?count=${count}`, token);

      if (response.status === 0) {
        return { ok: false, reason: 'request_failed', message: 'could not reach the server' };
      }
      if (response.status === 401) {
        return { ok: false, reason: 'unauthorized' };
      }
      const items = (response.body?.items as unknown as WireQueueItem[] | undefined) ?? [];
      return { ok: true, items: items.map(toQueueItem) };
    },

    async submitSolve(token, itemId, answer) {
      const response = await call(fetchImpl, 'POST', `${baseUrl}/${itemId}/solve`, token, {
        answer,
      });

      if (response.status === 0) {
        return { ok: false, reason: 'request_failed', message: 'could not reach the server' };
      }
      if (response.status === 401) {
        return { ok: false, reason: 'unauthorized' };
      }
      if (response.status === 200) {
        return {
          ok: true,
          itemId: response.body?.itemId as number,
          answer: response.body?.answer as OptionLabel,
        };
      }
      const reason = errorReason(response, 'not_claimed_by_you');
      return {
        ok: false,
        reason: reason === 'already_answered' ? 'already_answered' : 'not_claimed_by_you',
      };
    },

    async reveal(token, itemId) {
      const response = await call(fetchImpl, 'GET', `${baseUrl}/${itemId}/reveal`, token);

      if (response.status === 0) {
        return { ok: false, reason: 'request_failed', message: 'could not reach the server' };
      }
      if (response.status === 401) {
        return { ok: false, reason: 'unauthorized' };
      }
      if (response.status === 200) {
        return { ok: true, result: response.body as unknown as RevealResult };
      }
      const reason = errorReason(response, 'not_claimed_by_you');
      return {
        ok: false,
        reason: reason === 'not_yet_solved' ? 'not_yet_solved' : 'not_claimed_by_you',
      };
    },

    async decide(token, itemId, input, idempotencyKey) {
      const body = idempotencyKey === undefined ? input : { ...input, idempotencyKey };
      const response = await call(fetchImpl, 'POST', `${baseUrl}/${itemId}/decide`, token, body);

      if (response.status === 0) {
        return { ok: false, reason: 'request_failed', message: 'could not reach the server' };
      }
      if (response.status === 401) {
        return { ok: false, reason: 'unauthorized' };
      }
      if (response.status === 200) {
        return {
          ok: true,
          itemId: response.body?.itemId as number,
          status: response.body?.status as ItemStatus,
          approvalRoute: (response.body?.approvalRoute as ApprovalRoute | null) ?? null,
          decisionContext: response.body?.decisionContext as DecisionContext,
        };
      }
      if (errorReason(response, '') === 'invalid_transition') {
        return {
          ok: false,
          reason: 'invalid_transition',
          message: (response.body?.message as string) ?? 'invalid transition',
        };
      }
      return { ok: false, reason: 'not_claimed_by_you' };
    },

    async getContentDashboard(token, since) {
      const response = await call(
        fetchImpl,
        'GET',
        `/api/content-lead/dashboard?since=${encodeURIComponent(since.toISOString())}`,
        token,
      );

      if (response.status === 0) {
        return { ok: false, reason: 'request_failed', message: 'could not reach the server' };
      }
      if (response.status === 401) {
        return { ok: false, reason: 'unauthorized' };
      }
      if (response.status === 403) {
        return { ok: false, reason: 'forbidden' };
      }
      return { ok: true, dashboard: toContentDashboard(response.body as unknown as WireContentDashboard) };
    },
  };
}
